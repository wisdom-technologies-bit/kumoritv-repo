import "server-only";
import { streamRequestHeaders } from "@/app/lib/watch/headers";
import {
  normalizeProviderStreams,
  type NormalizedStream,
} from "@/app/lib/watch/streams";
import { ANI_PROVIDER, ANI_SERVER_LABEL } from "./constants";
import { mapAniSubtitles, type PublicSubtitle } from "./subtitles";
import type { AniStreamResponse } from "./types";

/**
 * Build the SAME winner object `resolveProvider` returns for Anivexa, so every
 * line below the provider loop (probe already done, proxy signing, subtitle
 * rewriting, server buttons) is shared instead of duplicated.
 *
 * `url` is the RAW upstream `master_url`, never `proxied_master_url`: the player
 * fetches the manifest through this app's own signed proxy, so the browser never
 * needs - and never sees - the ani-api key.
 *
 * The synthesised `json` is shaped like an Anivexa payload (`streams[]`) because
 * that is what `normalizeProviderStreams` / `buildServerButtons` / `toServerList`
 * already understand. One stream, one button, labelled "Kumori".
 */
export type AniWinner = {
  provider: typeof ANI_PROVIDER;
  server: string;
  stream: NormalizedStream;
  json: unknown;
  headers: Record<string, string>;
  embedOnly: false;
  /** Already in the public subtitle shape; the route only signs each url. */
  subtitles: PublicSubtitle[];
};

const FALLBACK_REFERER = "https://zokoanime.video/";

export function aniReferer(stream: AniStreamResponse): string {
  const required = stream.headers_required?.master_playlist;
  const referer =
    (required && (required.Referer || required.referer)) || FALLBACK_REFERER;
  return String(referer);
}

export function buildAniWinner(
  stream: AniStreamResponse,
  sublang: string,
): AniWinner | null {
  const url = typeof stream.master_url === "string" ? stream.master_url : "";
  if (!url) return null;
  const referer = aniReferer(stream);

  const json = {
    provider: ANI_PROVIDER,
    streams: [
      {
        type: "hls",
        url,
        server: ANI_SERVER_LABEL,
        referer,
        headers: { Referer: referer },
        priority: 1,
        isActive: true,
      },
    ],
    subtitles: [],
  };

  const [normalized] = normalizeProviderStreams(json);
  if (!normalized) return null;

  return {
    provider: ANI_PROVIDER,
    server: normalized.server,
    stream: normalized,
    json,
    headers: streamRequestHeaders(normalized),
    embedOnly: false,
    subtitles: mapAniSubtitles(stream.subtitles, sublang),
  };
}
