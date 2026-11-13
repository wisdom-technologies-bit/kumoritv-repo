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
