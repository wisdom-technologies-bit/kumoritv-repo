import "server-only";

/**
 * Server entry point for the ani provider. Nothing in here may ever be imported
 * by a client component; the two constants the player needs live in
 * ./constants, which is deliberately free of `server-only`.
 */
export { ANI_PROVIDER, ANI_SERVER_LABEL } from "./constants";
export { aniConfig, aniReady, aniBucket, aniRolloutAllows } from "./config";
export type { AniConfig } from "./config";
export { aniGate, lookupMalId, resolveAni } from "./resolve";
export type { AniGate, AniGateInput, AniResolveOutcome } from "./resolve";
export { buildAniWinner } from "./stream";
export type { AniWinner } from "./stream";
export { mapAniSubtitles } from "./subtitles";
export type { PublicSubtitle } from "./subtitles";
export {
  getAniStream,
  recordAniOutcome,
  aniStats,
  isAllowedUpstreamUrl,
  negativeTtlMs,
  validateAniStream,
  ANI_UPSTREAM_HOSTS,
  __resetAniStateForTests,
} from "./client";
export type { AniStreamResult, AniTraceEntry } from "./client";
export type { AniReason } from "./errors";
export type { AniStreamResponse } from "./types";
