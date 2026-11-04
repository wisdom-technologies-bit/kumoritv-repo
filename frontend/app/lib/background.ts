// Fire-and-forget work that keeps running after the response is sent.
//
// Vercel gives us `waitUntil`, which keeps the function alive until the promise
// settles. Render and Railway have no such API, so the task is simply left to run
// detached and tracked here: a SIGTERM handler drains it before the process exits.
// Nothing in this module ever throws or rejects, so a caller can hand it a task
// without a try/catch and without awaiting it.

import { waitUntil } from "@vercel/functions";

export type BackgroundTask<T = unknown> =
  | PromiseLike<T>
  | (() => PromiseLike<T> | T);

export type BackgroundOptions = { label?: string };

/** How long a shutdown waits for in-flight work when nothing is configured. */
export const BACKGROUND_DRAIN_TIMEOUT_MS = 10_000;

/** Tasks that are still running on a platform without `waitUntil`. */
const inFlight = new Set<Promise<void>>();

let signalHandlersInstalled = false;
let shuttingDown = false;

function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

export function backgroundDrainTimeoutMs(): number {
  const configured = Number(process.env.BACKGROUND_DRAIN_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : BACKGROUND_DRAIN_TIMEOUT_MS;
}

/** Starts the task now, resolving (never rejecting) once it settles. */
function startTask<T>(task: BackgroundTask<T>, label: string): Promise<void> {
  let started: PromiseLike<T> | T;
  try {
    started = typeof task === "function" ? task() : task;
  } catch (error) {
    console.error(`[background] ${label} failed:`, error);
    return Promise.resolve();
  }
  // Promise.resolve adopts a thenable (a Supabase query builder) as well as a
  // promise; a plain value just settles on the next tick.
  return Promise.resolve(started).then(
    () => undefined,
    (error: unknown) => {
      console.error(`[background] ${label} failed:`, error);
    },
  );
}

function trackDetached(task: Promise<void>): void {
  inFlight.add(task);
  void task.finally(() => {
    inFlight.delete(task);
  });
}

/**
 * Runs `task` after the response without the caller awaiting it.
 *
 * On Vercel it is handed to `waitUntil`; everywhere else it runs detached and is
 * tracked so `drainBackground` can wait for it on shutdown.
 */
export function runInBackground<T>(
  task: BackgroundTask<T>,
  options: BackgroundOptions = {},
): void {
  const label = options.label || "task";
  const promise = startTask(task, label);

  if (isVercel()) {
    try {
      waitUntil(promise);
      return;
    } catch {
      // Outside a request context `waitUntil` throws; fall through to detached.
    }
  }

  trackDetached(promise);
  installSignalHandlers();
}

export function pendingBackgroundCount(): number {
  return inFlight.size;
}

/** Resolves true once every tracked task has settled, false if it timed out. */
function waitForInFlight(remainingMs: number): Promise<boolean> {
  const settled = Promise.allSettled([...inFlight]).then(() => true);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), remainingMs);
  });
  return Promise.race([settled, timedOut]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Waits for in-flight work, re-checking the set because a task may start others.
 * Returns false if the timeout hit first.
 */
export async function drainBackground(
  timeoutMs: number = backgroundDrainTimeoutMs(),
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (inFlight.size > 0) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    if (!(await waitForInFlight(remaining))) return false;
  }
  return true;
}

/**
 * Exits only after queued log lines reach a piped stdout, so a shutting-down
 * process does not lose the drain report.
 */
function exitAfterLogs(code = 0): void {
  const fallback = setTimeout(() => process.exit(code), 1_000);
  fallback.unref?.();
  try {
    process.stdout.write("", () => {
      clearTimeout(fallback);
      process.exit(code);
    });
  } catch {
    clearTimeout(fallback);
    process.exit(code);
  }
}

function installSignalHandlers(): void {
  if (signalHandlersInstalled) return;
  signalHandlersInstalled = true;

  if (process.env.NEXT_MANUAL_SIG_HANDLE !== "true") {
    // Next's own SIGTERM handler calls process.exit(0) and would end the process
    // before the drain below gets a chance to run.
    console.warn(
      '[background] NEXT_MANUAL_SIG_HANDLE is not "true"; Next.js exits on SIGTERM before background work drains. Set NEXT_MANUAL_SIG_HANDLE=true in the start command.',
    );
  }

  const onSignal = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    const pending = pendingBackgroundCount();
    console.log(`[background] ${signal} received, draining ${pending} background task(s)`);
    void drainBackground().then((drained) => {
      if (!drained) {
        console.warn(
          `[background] drain timed out after ${backgroundDrainTimeoutMs()}ms; ${pendingBackgroundCount()} task(s) still running`,
        );
      }
      exitAfterLogs(0);
    });
  };

  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
}
