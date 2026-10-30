import type { ImportResult } from "./import";
import { isSystemicFailure } from "./import";

/**
 * The import-queue run loop.
 *
 * Production symptom this fixes: /api/cron/status showed the job "claiming 6081
 * rows in 200s with errors: 6081" while `anime_import_queue` held 5 rows. The
 * failure mode was a hot loop: row statuses were written with a value outside the
 * table's CHECK (pending, processing, done, error, not_found) - e.g. "no_streams" -
 * so the UPDATE failed silently, the row stayed `processing`, `claim_import_batch`
 * handed it straight back after its 10-minute takeover window, and AniList was hit
 * thousands of times for the same handful of ids.
 *
 * Guards here:
 *  (a) never import the same anilist_id twice in one run;
 *  (b) stop when a claimed batch contains only ids already seen (no progress);
 *  (c) every `.update` is checked and its error logged;
 *  (d) a circuit breaker after 10 consecutive failures with the same message;
 *  (e) a hard cap of MAX_IMPORTS_PER_RUN imports per run;
 *  (f) systemic failures (AniList/Anivexa down, timeouts, 429, 5xx) are rescheduled
 *      with backoff and NEVER marked terminal.
 */

export const MAX_IMPORTS_PER_RUN = 150;
export const CIRCUIT_FAILURE_LIMIT = 10;
/** Statuses the anime_import_queue CHECK constraint accepts, and nobody else. */
export const VALID_QUEUE_STATUSES = ["pending", "processing", "done", "error", "not_found"] as const;

export type QueueStatus = (typeof VALID_QUEUE_STATUSES)[number];

export type QueueRow = {
  anilist_id: number;
  attempts?: number | null;
  snapshot?: unknown;
  status?: string | null;
};

/** AniList/Anivexa may say "AniList metadata unavailable" - never `processing`. */
export function normalizeQueueStatus(status: string | null | undefined, fallback: QueueStatus = "pending"): QueueStatus {
  const value = String(status ?? "").trim().toLowerCase();
  if ((VALID_QUEUE_STATUSES as readonly string[]).includes(value)) return value as QueueStatus;
  // A legacy/invented status must not be written back: it would fail the CHECK and
  // leave the row `processing` forever, which is exactly the hot loop.
  if (value === "no_streams") return fallback;
  return fallback;
}

export type QueueDecision = {
  /** The status to persist (always inside the CHECK constraint). */
  status: QueueStatus;
  /** True when the row will never be retried. */
  terminal: boolean;
  /** The wipe of a claim increment: systemic failures did not burn an attempt. */
  restoreAttempt: boolean;
  lastError: string | null;
};

/**
 * Maps one ImportResult onto the queue row.
 *
 * `attempts` is the value the claim function already wrote (it increments on
 * claim), so "attempts >= 6" means this is the sixth try.
 */
export function decideQueueState(
  result: ImportResult,
  row: { attempts?: number | null },
  options: { noStreamsTerminalAfter?: number; errorTerminalAfter?: number } = {},
): QueueDecision {
  const attempts = Number(row?.attempts) || 0;
  const noStreamsTerminalAfter = options.noStreamsTerminalAfter ?? 6;
  const errorTerminalAfter = options.errorTerminalAfter ?? 8;

  if (result.status === "ok") {
    return { status: "done", terminal: true, restoreAttempt: false, lastError: null };
  }

  if (result.status === "not_found") {
    return { status: "not_found", terminal: true, restoreAttempt: false, lastError: result.message ?? "not found on AniVexa" };
  }

  if (result.status === "no_streams") {
    // Terminal only once it has failed enough times to be a real answer; before
    // that it goes back to `pending` (never to an invented status).
    const terminal = attempts >= noStreamsTerminalAfter;
    return {
      status: terminal ? "error" : "pending",
      terminal,
      restoreAttempt: false,
      lastError: terminal ? "no_streams" : (result.message ?? "no streams"),
    };
  }

  // status === "error"
  if (isSystemicFailure(result)) {
    // Rate limited / AniList or AniVexa down / timeout: not this anime's fault.
    // Give the attempt back and retry later with backoff.
    return {
      status: "pending",
      terminal: false,
      restoreAttempt: true,
      lastError: result.message ?? "systemic failure",
    };
  }

  const terminal = attempts >= errorTerminalAfter;
  return {
    status: terminal ? "error" : "pending",
    terminal,
    restoreAttempt: false,
    lastError: result.message ?? "import failed",
  };
}

export type ImportQueueStats = {
  claimed: number;
  imported: number;
  ok: number;
  notFound: number;
  noStreams: number;
  errors: number;
  updateErrors: number;
  skippedDuplicates: number;
  stopped: "empty" | "deadline" | "cap" | "no_progress" | "circuit_open" | null;
  message?: string;
};

export type RunImportQueueOptions = {
  db: any;
  /** Rows per claim_import_batch call. */
  batch?: number;
  /** Max imports per run; hard-capped at MAX_IMPORTS_PER_RUN. */
  limit?: number;
  deadline?: () => boolean;
  importOne?: (id: number, row: QueueRow) => Promise<ImportResult>;
  /** Claim hook, overridable so tests can drive the loop without PostgREST. */
  claim?: (size: number) => Promise<QueueRow[]>;
  retryDelayMs?: (attempts: number) => number;
  now?: () => number;
  log?: (message: string, payload: unknown) => void;
};

export async function runImportQueue(options: RunImportQueueOptions): Promise<ImportQueueStats> {
  const {
    db,
    batch = 8,
    deadline = () => false,
    claim,
    importOne,
    retryDelayMs = (attempts: number) => Math.min(21600000, 300000 * 2 ** Math.max(0, attempts - 1)),
    now = () => Date.now(),
    log = (message: string, payload: unknown) => console.log(message, JSON.stringify(payload)),
  } = options;

  const limit = Math.min(MAX_IMPORTS_PER_RUN, Math.max(1, options.limit ?? MAX_IMPORTS_PER_RUN));
  const claimBatch = Math.max(1, Math.min(25, batch));

  const stats: ImportQueueStats = {
    claimed: 0,
    imported: 0,
    ok: 0,
    notFound: 0,
    noStreams: 0,
    errors: 0,
    updateErrors: 0,
    skippedDuplicates: 0,
    stopped: null,
  };

  const seen = new Set<number>();
  let consecutiveFailures = 0;
  let lastFailureMessage: string | null = null;

  const runClaim =
    claim ??
    (async (size: number): Promise<QueueRow[]> => {
      const { data, error } = await db.rpc("claim_import_batch", { batch: size });
      if (error) {
        // A failing claim must not spin: report it and stop the run.
        throw new Error(error.message ?? String(error));
      }
      return Array.isArray(data) ? (data as QueueRow[]) : [];
    });

  const persist = async (row: QueueRow, decision: QueueDecision) => {
    const patch: Record<string, unknown> = {
      status: decision.status,
      last_error: decision.lastError,
      next_attempt_at: decision.terminal
        ? new Date(now()).toISOString()
        : new Date(now() + retryDelayMs(Number(row?.attempts) || 1)).toISOString(),
      processed_at: new Date(now()).toISOString(),
    };

    if (decision.restoreAttempt) patch.attempts = Math.max(0, (Number(row?.attempts) || 0) - 1);

    try {
      const { error } = await db.from("anime_import_queue").update(patch).eq("anilist_id", row.anilist_id);

      if (error) {
        stats.updateErrors += 1;
        // (c) The silent failure that caused the hot loop.
        console.warn("[import-queue] update failed", error.message ?? String(error), {
          anilist_id: row.anilist_id,
          status: decision.status,
        });
      }
    } catch (error) {
      stats.updateErrors += 1;
      console.warn("[import-queue] update failed", error instanceof Error ? error.message : String(error), {
        anilist_id: row.anilist_id,
        status: decision.status,
      });
    }
  };

  while (stats.imported < limit) {
    if (deadline()) {
      stats.stopped = "deadline";
      break;
    }

    const remaining = limit - stats.imported;
    let claimedRows: QueueRow[];
    try {
      claimedRows = await runClaim(Math.min(claimBatch, remaining));
    } catch (error) {
      stats.stopped = "empty";
      stats.message = error instanceof Error ? error.message : String(error);
      break;
    }

    if (!claimedRows.length) {
      stats.stopped = stats.stopped ?? "empty";
      break;
    }

    stats.claimed += claimedRows.length;

    // (a) one import per anilist_id per run.
    const fresh = claimedRows.filter((row) => {
      const id = Number(row?.anilist_id);
      if (!Number.isInteger(id) || id <= 0 || seen.has(id)) {
        stats.skippedDuplicates += 1;
        return false;
      }
      seen.add(id);
      return true;
    });

    // (b) a batch of nothing but known ids means the claim is looping.
    if (!fresh.length) {
      stats.stopped = "no_progress";
      console.warn("[import-queue] claim returned only ids already imported this run; stopping", {
        batch: claimedRows.length,
      });
      break;
    }

    for (const row of fresh) {
      if (stats.imported >= limit) {
        stats.stopped = "cap";
        break;
      }

      if (deadline()) {
        stats.stopped = "deadline";
        break;
      }

      const id = Number(row.anilist_id);
      stats.imported += 1;

      let result: ImportResult;

      try {
        result =
          (await importOne?.(id, row)) ??
          ({ status: "error", episodes: 0, message: "no importer configured", systemic: true } as ImportResult);
      } catch (error) {
        result = {
          status: "error",
          episodes: 0,
          message: error instanceof Error ? error.message : String(error),
          systemic: isSystemicFailure({ message: error instanceof Error ? error.message : String(error) }),
        };
      }

      if (result.status === "ok") stats.ok += 1;
      else if (result.status === "not_found") stats.notFound += 1;
      else if (result.status === "no_streams") stats.noStreams += 1;
      else stats.errors += 1;

      // (d) circuit breaker: the same failure ten times in a row is not a per-row
      // problem, so stop burning the run (and AniList) on it.
      const failed = result.status === "error" || result.status === "no_streams";
      if (failed) {
        const message = result.message || (result.status === "no_streams" ? "no_streams" : "unknown");
        if (message === lastFailureMessage) consecutiveFailures += 1;
        else {
          lastFailureMessage = message;
          consecutiveFailures = 1;
        }
      } else {
        consecutiveFailures = 0;
        lastFailureMessage = null;
      }

      await persist(row, decideQueueState(result, row));

      if (consecutiveFailures >= CIRCUIT_FAILURE_LIMIT) {
        stats.stopped = "circuit_open";
        stats.message = lastFailureMessage ?? "repeated failure";
        console.warn("[import-queue] circuit open: 10 consecutive failures with the same message", {
          message: stats.message,
        });
        break;
      }
    }

    if (stats.stopped === "circuit_open" || stats.stopped === "cap" || stats.stopped === "deadline") break;
  }

  if (!stats.stopped) stats.stopped = stats.imported >= limit ? "cap" : "empty";

  log("[import-queue] run summary", {
    claimed: stats.claimed,
    imported: stats.imported,
    ok: stats.ok,
    notFound: stats.notFound,
    noStreams: stats.noStreams,
    errors: stats.errors,
    updateErrors: stats.updateErrors,
    skippedDuplicates: stats.skippedDuplicates,
    stopped: stats.stopped,
    ...(stats.message ? { message: stats.message } : {}),
  });

  return stats;
}
