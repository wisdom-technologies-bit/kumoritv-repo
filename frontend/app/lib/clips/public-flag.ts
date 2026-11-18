// Phase 5: the one flag for the public clips browse.
//
// Read on every call, never cached at module level, exactly like
// COMMUNITY_ENABLED: the owner turns it on after checking, and a Railway
// variable change must take effect without a rebuild. With it off, /api/clips
// (GET) is a 404 and /clips behaves as it did before Phase 5 - "My clips" only.
const TRUTHY = new Set(["1", "true", "yes", "on"]);

export function isClipsPublicEnabled(): boolean {
  const value = (process.env.CLIPS_PUBLIC_ENABLED ?? "").trim().toLowerCase();
  return TRUTHY.has(value);
}
