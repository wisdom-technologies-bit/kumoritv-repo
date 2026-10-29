// Shared types for the Prompt 9 user-data layer.

export type MediaTitle = {
  romaji: string;
  english?: string | null;
  native?: string | null;
  userPreferred?: string | null;
};

export type MediaCover = { extraLarge: string; large: string };

export type FavouriteSnapshot = {
  id: number;
  title: MediaTitle;
  format: string;
  description: string;
  coverImage: MediaCover;
};

export type ListStatus =
  | "watching"
  | "planning"
  | "completed"
  | "dropped"
  | "paused"
  | "repeating";

export type AnilistListStatus =
  | "CURRENT"
  | "PLANNING"
  | "COMPLETED"
  | "DROPPED"
  | "PAUSED"
  | "REPEATING";

export type ListEntry = {
  id: number;
  status: ListStatus;
  progress: number;
  updatedAt: number;
  snapshot: FavouriteSnapshot;
};

export type ProgressSnapshot = {
  title: MediaTitle | string | null;
  cover: string | null;
  /** Episode thumbnail, so Keep Watching never falls back to a placeholder. */
  episodeImage?: string | null;
};

export type ServerProgressRow = {
  anilist_id: number;
  episode_number: number;
  position_seconds: number;
  duration_seconds: number | null;
  audio: string;
  completed: boolean;
  snapshot: ProgressSnapshot | string | null;
  updated_at: string;
};

export type NotificationRow = {
  id: string;
  user_id: string;
  anilist_id: number;
  episode: number;
  title: string | null;
  cover_url: string | null;
  created_at: string;
  read_at: string | null;
};

export type UserPrefs = {
  autoSkip: boolean;
  autoNext: boolean;
  dubEpisodes: boolean;
  subtitle_language: string;
};

export type ProfilePrefsRow = {
  auto_skip: boolean | null;
  auto_next: boolean | null;
  preferred_audio: string | null;
  subtitle_language: string | null;
  created_at: string;
  updated_at: string;
};
