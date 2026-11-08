import "server-only";

// Claim → fetch → write for one anime's title logo, shared by the cron job
// (`/api/cron/logos`) and the lazy, after-the-response fill on the media page.
//
// Every database read/write is defensive: the `logo_*` columns only exist after
// the migration in `supabase/migrations` has been applied, and a missing column
// must never break the page or the job. Without the columns the job reports
// nothing to do and the page renders the text title.

import { createAdminClient } from "@/app/lib/supabase/admin";
import { fetchLogoFor, logoUrl, tmdbConfigured, tmdbIdFromMappings } from "./logos";

export type TitleLogoValue = {
  url: string;
  aspectRatio: number;
  width: number;
};

// The generated Supabase types are handy elsewhere but too rigid for a table
// whose columns are added by a migration the deploy may predate.
type Db = { from: (table: string) => any };

type AnimeRow = {
  anilist_id: number;
  mappings?: unknown;
  format?: string | null;
  logo_path?: string | null;
  logo_status?: string | null;
  logo_checked_at?: string | null;
};

export type LogoStats = {
  claimed: number;
  found: number;
  none: number;
  errors: number;
  skipped: number;
  rateLimited: boolean;
  remaining: number;
  retryAfterMs?: number;
};

const CONCURRENCY = 4;
const ERROR_RETRY_MS = 60 * 60 * 1000; // 1 hour
const MISSING_RECHECK_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const COLUMNS = "anilist_id, mappings, format, logo_path, logo_status, logo_checked_at";

function isoBefore(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

/** The small read the media page does. Never throws, never blocks on an error. */
export async function readTitleLogo(
  anilistId: number,
): Promise<{ logo?: TitleLogoValue; pending: boolean }> {
  const db = createAdminClient() as Db | null;
  if (!db) return { pending: false };

  try {
    const { data, error } = await db
      .from("anime")
      .select("logo_path, logo_aspect_ratio, logo_width, logo_checked_at")
      .eq("anilist_id", anilistId)
      .maybeSingle();

    if (error || !data) return { pending: false };

    const row = data as {
      logo_path?: string | null;
      logo_aspect_ratio?: number | string | null;
      logo_width?: number | string | null;
      logo_checked_at?: string | null;
    };

    const url = logoUrl(row.logo_path);
    const aspectRatio = Number(row.logo_aspect_ratio);
    const width = Number(row.logo_width);

    const logo = url
      ? {
          url,
          aspectRatio: Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 3,
          width: Number.isFinite(width) && width > 0 ? width : 1000,
        }
      : undefined;

    return { logo, pending: row.logo_checked_at == null };
  } catch {
    return { pending: false };
  }
}

async function writeLogo(db: Db, anilistId: number, patch: Record<string, unknown>): Promise<boolean> {
  try {
    const { error } = await db.from("anime").update(patch).eq("anilist_id", anilistId);

    if (error) return false;

    return true;
  } catch {
    return false;
  }
}

/** Atomically takes the row so two overlapping runs never process it twice. */
async function claimRow(db: Db, row: AnimeRow, force: boolean): Promise<boolean> {
  try {
    let query = db.from("anime").update({ logo_checked_at: new Date().toISOString() }).eq("anilist_id", row.anilist_id);

    if (!force) {
      // Same staleness window the row was selected under. A row with a
      // `logo_checked_at` but no `logo_status` is a claim whose run died before
      // it could write a result, so it retries on the short (error) window - not
      // the 30-day one, which would strand it for a month.
      if (!row.logo_checked_at) query = query.is("logo_checked_at", null);
      else if (row.logo_status === "error" || row.logo_status == null) {
        query = query.lt("logo_checked_at", isoBefore(ERROR_RETRY_MS));
      } else query = query.lt("logo_checked_at", isoBefore(MISSING_RECHECK_MS));

      query = query.is("logo_path", null);
    }

    const { data, error } = await query.select("anilist_id");

    if (error) return false;

    return Array.isArray(data) ? data.length > 0 : Boolean(data);
  } catch {
    return false;
  }
}

/** ONE batched read of the stored logos for a page that shows several titles
 *  at once (the home hero). Never throws: any error means "no logos", and the
 *  caller falls back to the text title. */
export async function readTitleLogos(
  anilistIds: Array<number | string>,
): Promise<Record<number, TitleLogoValue>> {
  const logos: Record<number, TitleLogoValue> = {};

  const ids = Array.from(
    new Set(
      (anilistIds || [])
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  );

  if (!ids.length) return logos;

  const db = createAdminClient() as Db | null;
  if (!db) return logos;

  try {
    const { data, error } = await db
      .from("anime")
      .select("anilist_id, logo_path, logo_aspect_ratio, logo_width")
      .in("anilist_id", ids)
      .not("logo_path", "is", null);

    if (error || !Array.isArray(data)) return logos;

    for (const value of data) {
      const row = value as {
        anilist_id?: number | string | null;
        logo_path?: string | null;
        logo_aspect_ratio?: number | string | null;
        logo_width?: number | string | null;
      };

      const anilistId = Number(row.anilist_id);
      if (!Number.isInteger(anilistId) || anilistId <= 0) continue;

      const url = logoUrl(row.logo_path, "w500");
      if (!url) continue;

      const aspectRatio = Number(row.logo_aspect_ratio);
      const width = Number(row.logo_width);

      logos[anilistId] = {
        url,
        aspectRatio: Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 3,
        width: Number.isFinite(width) && width > 0 ? width : 500,
      };
    }
  } catch {
    return logos;
  }

  return logos;
}

type Single = "found" | "none" | "error" | "skipped" | "rate_limited";

async function processOne(
  db: Db,
  row: AnimeRow,
  options: { force: boolean },
): Promise<{ outcome: Single; retryAfterMs?: number }> {
  const claimed = await claimRow(db, row, options.force);

  if (!claimed) return { outcome: "skipped" };

  const mappings = row.mappings as Record<string, unknown> | null | undefined;
  const tmdbId = tmdbIdFromMappings(mappings);
  const format =
    (typeof mappings?.format === "string" && mappings.format) || (typeof row.format === "string" ? row.format : null);

  // No TMDB id: stamp it and move on. The resync/import job refreshes
  // `mappings`; the daily recheck (or `force=1`) picks it up afterwards.
  if (!tmdbId) {
    await writeLogo(db, row.anilist_id, { logo_status: "none", logo_checked_at: new Date().toISOString() });

    return { outcome: "none" };
  }

  const result = await fetchLogoFor({ tmdbId, format });

  if (result.status === "found") {
    const written = await writeLogo(db, row.anilist_id, {
      logo_path: result.logo.path,
      logo_aspect_ratio: result.logo.aspectRatio,
      logo_width: result.logo.width,
      logo_status: "found",
      logo_checked_at: new Date().toISOString(),
    });

    return { outcome: written ? "found" : "error" };
  }

  if (result.status === "none") {
    await writeLogo(db, row.anilist_id, { logo_status: "none", logo_checked_at: new Date().toISOString() });

    return { outcome: "none" };
  }

  if (result.status === "rate_limited") {
    // Release the claim: nothing was written for this row.
    await writeLogo(db, row.anilist_id, { logo_checked_at: null });

    return { outcome: "rate_limited", retryAfterMs: result.retryAfterMs };
  }

  if (result.status === "disabled") return { outcome: "skipped" };

  await writeLogo(db, row.anilist_id, { logo_status: "error", logo_checked_at: new Date().toISOString() });

  return { outcome: "error" };
}

async function countRemaining(db: Db): Promise<number> {
  try {
    const { count, error } = await db
      .from("anime")
      .select("anilist_id", { count: "exact", head: true })
      .is("logo_checked_at", null)
      .not("mappings", "is", null);

    if (error) return 0;

    return typeof count === "number" ? count : 0;
  } catch {
    return 0;
  }
}

async function selectRows(db: Db, build: (query: any) => any): Promise<AnimeRow[]> {
  try {
    const query = build(db.from("anime").select(COLUMNS));
    const { data, error } = await query;

    // A missing column (migration not applied yet) simply means "no candidates".
    // Any other error is treated the same: the job does its best, the page is
    // unaffected.
    if (error) return [];

    return Array.isArray(data) ? (data as AnimeRow[]) : [];
  } catch {
    return [];
  }
}

async function candidates(
  db: Db,
  { batch, force, anilistId }: { batch: number; force: boolean; anilistId?: number | null },
): Promise<AnimeRow[]> {
  const order = (query: any) => query.order("score", { ascending: false, nullsFirst: false }).limit(batch);

  if (anilistId) {
    return selectRows(db, (query) => query.eq("anilist_id", anilistId).limit(1));
  }

  if (force) {
    return selectRows(db, (query) => order(query));
  }

  const fresh = await selectRows(db, (query) =>
    order(query.is("logo_path", null).is("logo_checked_at", null)),
  );

  const errored = await selectRows(db, (query) =>
    order(
      query
        .is("logo_path", null)
        .eq("logo_status", "error")
        .lt("logo_checked_at", isoBefore(ERROR_RETRY_MS)),
    ),
  );

  const missing = await selectRows(db, (query) =>
    order(
      query
        .is("logo_path", null)
        .eq("logo_status", "none")
        .lt("logo_checked_at", isoBefore(MISSING_RECHECK_MS)),
    ),
  );

  // A claim whose run was killed before it wrote a result: `logo_checked_at` is
  // set, `logo_status` never got written. Without this group such a row would
  // never be looked at again.
  const stale = await selectRows(db, (query) =>
    order(
      query
        .is("logo_path", null)
        .is("logo_status", null)
        .lt("logo_checked_at", isoBefore(ERROR_RETRY_MS)),
    ),
  );

  const seen = new Set<number>();
  const merged: AnimeRow[] = [];

  for (const row of [...fresh, ...errored, ...missing, ...stale]) {
    if (!row || typeof row.anilist_id !== "number") continue;
    if (seen.has(row.anilist_id)) continue;

    seen.add(row.anilist_id);
    merged.push(row);

    if (merged.length >= batch) break;
  }

  return merged;
}

/**
 * Processes one batch of logo candidates. Idempotent and resumable: every row is
 * claimed before any network call, and each outcome is written on its own.
 */
export async function processLogoCandidates({
  db,
  batch = 40,
  force = false,
  anilistId = null,
  deadline = () => false,
}: {
  db: Db;
  batch?: number;
  force?: boolean;
  anilistId?: number | null;
  deadline?: () => boolean;
}): Promise<LogoStats> {
  const stats: LogoStats = {
    claimed: 0,
    found: 0,
    none: 0,
    errors: 0,
    skipped: 0,
    rateLimited: false,
    remaining: 0,
  };

  // Not configured: nothing is fetched, nothing is logged as an error.
  if (!tmdbConfigured()) {
    stats.remaining = await countRemaining(db);

    return stats;
  }

  const rows = await candidates(db, { batch: Math.max(1, batch), force, anilistId });

  if (!rows.length) {
    stats.remaining = await countRemaining(db);

    return stats;
  }

  let stop = false;
  let cursor = 0;

  async function worker() {
    while (!stop) {
      const index = cursor++;
      if (index >= rows.length) return;
      if (deadline()) {
        stop = true;
        return;
      }

      // small jitter so the four workers do not hit TMDB in lockstep
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 120));

      const result = await processOne(db, rows[index], { force });

      if (result.outcome === "skipped") {
        stats.skipped += 1;
        continue;
      }

      // Everything else was claimed by this run.
      stats.claimed += 1;

      if (result.outcome === "found") stats.found += 1;
      else if (result.outcome === "none") stats.none += 1;
      else if (result.outcome === "error") stats.errors += 1;
      else if (result.outcome === "rate_limited") {
        stats.rateLimited = true;
        stats.retryAfterMs = result.retryAfterMs;
        stop = true;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, () => worker()));

  stats.remaining = await countRemaining(db);

  return stats;
}

/** One row, for the lazy fill after a media page render. Never awaited. */
export async function fillLogoForAnime(
  anilistId: number,
  options: { force?: boolean } = {},
): Promise<{ status: string }> {
  const db = createAdminClient() as Db | null;

  if (!db || !tmdbConfigured()) return { status: "disabled" };

  const stats = await processLogoCandidates({
    db,
    batch: 1,
    force: options.force === true,
    anilistId,
  });

  if (stats.found) return { status: "found" };
  if (stats.errors) return { status: "error" };
  if (stats.none) return { status: "none" };

  return { status: "skipped" };
}
