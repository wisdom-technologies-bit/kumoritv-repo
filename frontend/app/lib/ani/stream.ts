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

/**
 * Referer fallbacks per source.
 *
 * Measured 2026-11-15: AniKoto's master playlist, every variant playlist, every
 * segment (`*.twilightharbor.space`, `*.shadownest.top`, ...) and every
 * subtitle (`*.mysubsplay.com`) answer 403 unless the request carries
 * `Referer: https://megaplay.buzz/`. ZokoAnime wants its own site.
 *
 * The API usually states this in `headers_required.master_playlist.Referer`, and
 * that always wins; these constants only cover a response that omits it.
 */
const FALLBACK_REFERERS: Record<string, string> = {
  anikoto: "https://megaplay.buzz/",
  zokoanime: "https://zokoanime.video/",
};
const DEFAULT_FALLBACK_REFERER = "https://zokoanime.video/";

export function aniProviderName(stream: AniStreamResponse): string {
  return String(stream?.provider || "").trim().toLowerCase();
}

function fallbackReferer(stream: AniStreamResponse): string {
  return FALLBACK_REFERERS[aniProviderName(stream)] || DEFAULT_FALLBACK_REFERER;
}

/**
 * The one Referer every child request must carry.
 *
 * `headers_required.segments` is `{}` for AniKoto (the API is wrong about that),
 * so the master-playlist Referer is used for segments and subtitles as well: a
 * single effective Referer means the signed tokens for the manifest, the
 * variants, the segments, `#EXT-X-KEY`/`#EXT-X-MAP` and the subtitles all prove
 * the same thing, which is exactly the test `anikoto.test.ts` asserts.
 */
export function aniReferer(stream: AniStreamResponse): string {
  const required = stream.headers_required || {};
  const fromMaster = required.master_playlist;
  const fromSubtitles = required.subtitles;
  const fromSegments = required.segments;
  const pick = (bag: Record<string, string> | undefined) => {
    if (!bag) return "";
    const value = bag.Referer ?? bag.referer ?? bag.REFERER;
    return typeof value === "string" ? value.trim() : "";
  };
  return (
    pick(fromMaster) ||
    pick(fromSubtitles) ||
    pick(fromSegments) ||
    fallbackReferer(stream)
  );
}

/** `[start, end]` from the API -> `{start, end}`, or null when it is not usable. */
export function aniSkipRange(value: unknown): { start: number; end: number } | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const start = Number(value[0]);
  const end = Number(value[1]);
  // Both finite, end after start. `[0, 0]` (unknown) and `[NaN, 80]` are dropped;
  // `[0, 80]` is a real intro that starts at the very first frame.
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || end <= start) return null;
  return { start, end };
}

export function buildAniWinner(
  stream: AniStreamResponse,
  sublang: string,
): AniWinner | null {
  const url = typeof stream.master_url === "string" ? stream.master_url : "";
  if (!url) return null;
  const referer = aniReferer(stream);
  const intro = aniSkipRange(stream.intro);
  const outro = aniSkipRange(stream.outro);

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
        // The player reads provider ranges from the normalised stream and they
        // win over AniSkip, so the API's markers reach the Skip buttons here.
        intro,
        outro,
      },
    ],
    intro,
    outro,
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
    subtitles: mapAniSubtitles(stream.subtitles, sublang, aniProviderName(stream)),
  };
}
