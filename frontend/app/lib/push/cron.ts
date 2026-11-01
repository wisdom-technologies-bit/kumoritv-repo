// Sizing for /api/cron/push. Kept out of the route module so the route exports
// only what Next allows (its handlers and the segment config).

/** Outbox rows claimed per run. */
export const OUTBOX_BATCH = 200;
/** Digest candidates considered per run. */
export const DIGEST_USER_LIMIT = 200;
/** Episodes named per digest lookup. */
export const DIGEST_EPISODE_LIMIT = 50;
