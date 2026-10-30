"use client";
// Kept for backwards compatibility: the player and every existing import path use
// this module. The implementation now lives in app/lib/user-data/progress.ts, which
// adds Supabase sync behind the exact same exports and signatures.

export type { ProgressRecord } from "@/app/lib/user-data/progress";
export {
  CONTINUE_WATCHING_MIN_SECONDS,
  getProgress,
  shouldMarkFirstSave,
  saveProgress,
  markWatched,
  isWatched,
  listContinueWatching,
  subscribe,
  shouldResume,
  isProgressCompleted,
  listContinueWatchingFromServer,
  listContinueWatchingAsMediaData,
  deleteContinueWatching,
  syncProgressFromServer,
  flushProgress,
  hydrateProgress,
  clearProgress,
} from "@/app/lib/user-data/progress";
