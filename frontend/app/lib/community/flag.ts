// Prompt 38B: the one feature flag for the community.
//
// Read on every call, never cached at module level: the flag has to change
// behaviour at request time (a deploy with the flag off must 404 the routes,
// hide the footer link and leave the bell exactly as it was).
const TRUTHY = new Set(["1", "true", "yes", "on"]);

export function isCommunityEnabled(): boolean {
  const value = (process.env.COMMUNITY_ENABLED ?? "").trim().toLowerCase();
  return TRUTHY.has(value);
}

/**
 * Phase 4: the global kill switch for the new-post bar alone.
 *
 * Unset (or anything truthy) means the bar behaves as configured. `0`, `false`,
 * `off` or `no` turns it off for EVERY reader while leaving the community itself
 * on - the one thing an owner needs when a release day goes sideways and the
 * per-user switch is not enough.
 */
const FALSY = new Set(["0", "false", "off", "no"]);

export function isCommunityToastEnabled(): boolean {
  if (!isCommunityEnabled()) return false;
  const value = (process.env.COMMUNITY_TOASTS ?? "").trim().toLowerCase();
  return !FALSY.has(value);
}
