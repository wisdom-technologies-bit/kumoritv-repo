import "server-only";

/**
 * The subset of the ani-api `StreamResponse` (api/src/ani_api/models.py) this app
 * actually reads. Optional everywhere the API itself types a field Optional, so a
 * response that grows a field cannot break us and a missing one cannot pretend
 * to be present.
 */
export type AniAudioType = "sub" | "dub";

export type AniMalContext = {
  mal_id?: number;
  mal_episode?: number;
  hianime_id?: string;
  episode_id?: string;
  stream_verified?: boolean;
  verification?: string;
  evidence?: string | null;
  note?: string | null;
};

export type AniVariant = {
  quality?: string;
  height?: number | null;
  bandwidth_bps?: number | null;
  playlist_url?: string;
  first_segment_url?: string | null;
  /** null means "not probed"; only `true` counts as playable for us. */
  playable?: boolean | null;
  probe_http_code?: number | null;
  blocked_reason?: string | null;
};

export type AniSubtitleTrack = {
  url: string;
  id?: string;
  index?: number;
  label?: string | null;
  title?: string;
  language?: string;
  language_name?: string;
  language_source?: "provider_label" | "unknown";
  kind?: "full" | "signs" | "forced" | "dubtitle";
  format?: "vtt" | "srt" | "ass" | "unknown";
  converted?: boolean;
  playable?: boolean;
  default?: boolean;
  /** Provider's own lang: a constant "en" on every track observed. Never used. */
  provider_lang?: string | null;
  proxied_url?: string | null;
  /** Always false: the API never verifies a track's language. */
  language_verified?: boolean;
};

export type AniAudioInfo = {
  type?: AniAudioType;
  declared?: AniAudioType;
  detected_language?: string | null;
  /** Always false: audio language is declared, never verified. */
  verified?: boolean;
  note?: string | null;
};

export type AniHeadersRequired = {
  master_playlist?: Record<string, string>;
  subtitles?: Record<string, string>;
  segments?: Record<string, string>;
  [key: string]: unknown;
};

export type AniUrlLifetime = {
  observed_valid_for_minutes?: number | null;
  expiry_known?: boolean;
};

export type AniStreamResponse = {
  request_id?: string;
  provider?: string;
  stream_type?: "hls";
  master_url?: string | null;
  proxied_master_url?: string | null;
  variants?: AniVariant[];
  subtitles?: AniSubtitleTrack[];
  subtitle_count?: number;
  subtitle_default_id?: string | null;
  headers_required?: AniHeadersRequired;
  audio?: AniAudioInfo;
  url_lifetime?: AniUrlLifetime;
  warnings?: string[];
  mal?: AniMalContext | null;
};
