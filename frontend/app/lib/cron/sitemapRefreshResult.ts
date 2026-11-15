/**
 * Prompt 39B Part 1: what `refresh_sitemap_episodes()` returned, made pointless
 * to misread.
 *
 * The function used to return text ('concurrent' | 'full'). After
 * docs/sql/sitemap-refresh-fix.sql it returns jsonb:
 *   { ok, mode, rows, elapsed_ms, concurrent_error }
 *
 * Both shapes have to be understood, in this order, because the SQL file is run
 * by hand: the app can be deployed before it, and rolled back after it, without
 * the cron route ever logging "ok" for a refresh that did not run. The old code
 * did `typeof data === "string" ? data : "ok"`, which turned the jsonb object
 * into the word "ok" and threw away the row count - the one number that proves
 * the frozen view actually moved.
 */

export type SitemapRefreshOutcome = {
  /** One-line, log-safe summary, e.g. "concurrent rows=145740". */
  summary: string;
  /** 'concurrent' | 'full' | 'failed' | 'ok' (the fallback when nothing is reported). */
  mode: string | null;
  /** Rows the ranked view holds after the refresh, when the function says so. */
  rows: number | null;
  /** The function's own reason when REFRESH ... CONCURRENTLY was refused. */
  concurrentError: string | null;
};

export const EMPTY_REFRESH_OUTCOME: SitemapRefreshOutcome = {
  summary: "ok",
  mode: null,
  rows: null,
  concurrentError: null,
};

export function describeSitemapRefresh(data: unknown): SitemapRefreshOutcome {
  // The old text-returning function, and a rollback to it.
  if (typeof data === "string") {
    const mode = data.trim();
    return mode ? { ...EMPTY_REFRESH_OUTCOME, summary: mode, mode } : { ...EMPTY_REFRESH_OUTCOME };
  }

  // The jsonb object from docs/sql/sitemap-refresh-fix.sql.
  if (data && typeof data === "object") {
    const row = data as Record<string, unknown>;
    const mode =
      typeof row.mode === "string" && row.mode.trim() ? row.mode.trim() : "ok";
    // `Number(null)` is 0, so an absent row count must stay absent.
    const rows =
      row.rows === null || row.rows === undefined || row.rows === ""
        ? null
        : Number.isFinite(Number(row.rows))
          ? Number(row.rows)
          : null;
    const concurrentError =
      typeof row.concurrent_error === "string" && row.concurrent_error.trim()
        ? row.concurrent_error.trim()
        : null;

    return {
      summary: rows === null ? mode : `${mode} rows=${rows}`,
      mode,
      rows,
      concurrentError,
    };
  }

  return { ...EMPTY_REFRESH_OUTCOME };
}
