/**
 * Test stand-ins for the route tests.
 *
 * A REAL local HTTP server plays the ani-api, Anivexa and Supabase/PostgREST, so
 * the watch route runs its production code: real URLs, real JSON, real errors.
 * The video CDN hosts are answered from memory by `installMediaFetch`, because
 * the route's own SSRF guard only accepts real public hostnames for a stream URL
 * and `127.0.0.1` is deliberately refused.
 *
 * No real ani-api, no real Anivexa, no real Supabase project and no real video
 * host is contacted by any of this.
 */
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(here, "fixtures", name), "utf8"));

export const SUB_STREAM = fixture("stream-mal21-ep1-sub.json");
export const DUB_STREAM = fixture("stream-mal21-ep1-dub.json");
export const SUBTITLES = fixture("subtitles-multi.json");
export const ERRORS = fixture("errors.json");

export type AniMode =
  | "ok"
  | "mal_not_found"
  | "mal_not_mapped"
  | "mal_episode_mismatch"
  | "title_source"
  | "auth"
  | "rate"
  | "error"
  | "unverified"
  | "mismatch"
  | "dub_not_ok";

export type Standin = {
  url: string;
  port: number;
  state: {
    aniMode: AniMode;
    aniCalls: { url: string; apiKey: string | null }[];
    anivexaCalls: number;
    delayMs: number;
    episodes: Record<string, any>;
    anime: Record<string, { mal_id: number | null } | null>;
    episodePatches: any[];
  };
  close: () => Promise<void>;
};

const TS_BYTES = (() => {
  const bytes = Buffer.alloc(256);
  bytes[0] = 0x47;
  bytes[188] = 0x47;
  return bytes;
})();

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => ({
  status,
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

const ANIVEXA_MASTER = "https://cdn.anivexa-test.example/master.m3u8";
const ANIVEXA_SUB = "https://cdn.anivexa-test.example/english.vtt";

const ANIVEXA_PAYLOAD = {
  streams: [
    {
      server: "HD-1",
      type: "hls",
      url: ANIVEXA_MASTER,
      priority: 1,
      isActive: true,
      subtitles: [{ url: ANIVEXA_SUB, label: "English", kind: "full", format: "vtt" }],
    },
  ],
  subtitles: [{ url: ANIVEXA_SUB, label: "English", kind: "full", format: "vtt" }],
};

function aniResponse(mode: AniMode, audio: string) {
  const stream = audio === "dub" ? DUB_STREAM : SUB_STREAM;
  switch (mode) {
    case "mal_not_found":
      return json(ERRORS.MAL_NOT_FOUND, 404);
    case "mal_not_mapped":
      return json(ERRORS.MAL_NOT_MAPPED, 404);
    case "mal_episode_mismatch":
      return json(ERRORS.MAL_EPISODE_MISMATCH, 409);
    case "title_source":
      return json(ERRORS.MAL_TITLE_SOURCE_UNAVAILABLE, 503);
    case "auth":
      return json(ERRORS.UNAUTHORIZED, 401);
    case "rate":
      return json(ERRORS.RATE_LIMITED, 429, { "retry-after": "60" });
    case "error":
      return json({ code: "INTERNAL", title: "boom", status: 500 }, 500);
    case "unverified": {
      const body = structuredClone(stream);
      body.mal.stream_verified = false;
      body.mal.verification = "mapping_only";
      return json(body, 200);
    }
    case "mismatch": {
      const body = structuredClone(stream);
      body.mal.mal_episode = 2;
      return json(body, 200);
    }
    case "dub_not_ok": {
      const body = structuredClone(DUB_STREAM);
      body.audio.verified = true;
      return json(body, 200);
    }
    default:
      return json(stream, 200);
  }
}

export async function startStandin(): Promise<Standin> {
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url || "/", `http://127.0.0.1`);
    const pathname = url.pathname;
    const send = (result: { status: number; headers: Record<string, string>; body: string }) => {
      response.writeHead(result.status, { ...result.headers, connection: "close" });
      response.end(result.body);
    };

    if (pathname.startsWith("/v1/streams/mal/")) {
      standin.state.aniCalls.push({
        url: request.url || "",
        apiKey: (request.headers["x-api-key"] as string) || null,
      });
      const audio = url.searchParams.get("audio") || "sub";
      const reply = () => send(aniResponse(standin.state.aniMode, audio));
      if (standin.state.delayMs) setTimeout(reply, standin.state.delayMs);
      else reply();
      return;
    }

    if (pathname.startsWith("/ep/")) {
      standin.state.anivexaCalls++;
      return send(json(ANIVEXA_PAYLOAD, 200));
    }

    if (pathname.startsWith("/rest/v1/episodes")) {
      if (request.method === "PATCH") {
        let body = "";
        request.on("data", (chunk) => (body += chunk));
        request.on("end", () => {
          standin.state.episodePatches.push(body ? JSON.parse(body) : null);
          response.writeHead(204, { connection: "close" });
          response.end();
        });
        return;
      }
      const play = (url.searchParams.get("play_id") || "").replace(/^eq\./, "");
      const row = standin.state.episodes[play] ?? null;
      const accept = String(request.headers.accept || "");
      if (!row) return send(json([], 200));
      return send(
        json(accept.includes("pgrst.object") ? row : [row], 200),
      );
    }

    if (pathname.startsWith("/rest/v1/anime")) {
      const id = (url.searchParams.get("anilist_id") || "").replace(/^eq\./, "");
      const row = standin.state.anime[id] ?? null;
      const accept = String(request.headers.accept || "");
      if (!row) {
        return send(
          accept.includes("pgrst.object")
            ? json({ code: "PGRST116", message: "no rows" }, 406)
            : json([], 200),
        );
      }
      return send(json(accept.includes("pgrst.object") ? row : [row], 200));
    }

    return send(json({ error: "unhandled", pathname }, 404));
  });

  const standin: Standin = {
    url: "",
    port: 0,
    state: {
      aniMode: "ok",
      aniCalls: [],
      anivexaCalls: 0,
      delayMs: 0,
      episodes: {},
      anime: {},
      episodePatches: [],
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  standin.port = typeof address === "object" && address ? address.port : 0;
  standin.url = `http://127.0.0.1:${standin.port}`;
  return standin;
}

const MEDIA_HOST = /(dramahot\.top|drama1\.cfd|anivexa-test\.example)/i;

/**
 * Answers the CDN hosts in memory. Everything else (the local stand-in, and any
 * fetch a dependency makes) goes to the real `fetch`.
 */
/** A Response with a `url`, which a constructed Response does not have. */
function mediaResponse(url: string, body: BodyInit, init: ResponseInit = {}) {
  const response = new Response(body, init);
  Object.defineProperty(response, "url", { value: url, configurable: true });
  return response;
}

export function installMediaFetch() {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : String(input?.url || "");
    if (!MEDIA_HOST.test(url)) return realFetch(input, init);

    if (/master\.m3u8/.test(url))
      return mediaResponse(
        url,
        
        `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\n${new URL("360/index.m3u8", url).toString()}\n`,
        { status: 200, headers: { "content-type": "application/vnd.apple.mpegurl" } },
      );
    if (/\.m3u8/.test(url))
      return mediaResponse(
        url,
        
        "#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXT-X-VERSION:3\n#EXTINF:10.000,\nseg_00000.ts.jpg\n#EXT-X-ENDLIST\n",
        { status: 200, headers: { "content-type": "application/vnd.apple.mpegurl" } },
      );
    if (/\.ts(\.jpg)?$/.test(url))
      return mediaResponse(url, TS_BYTES, {
        status: 206,
        headers: { "content-type": "video/mp2t" },
      });
    if (/\.vtt$/.test(url))
      return mediaResponse(url, "WEBVTT\n\n00:00.000 --> 00:02.000\nHello\n", {
        status: 200,
        headers: { "content-type": "text/vtt" },
      });
    if (/\.srt$/.test(url))
      return mediaResponse(url, "1\n00:00:00,000 --> 00:00:02,000\nHello\n", {
        status: 200,
        headers: { "content-type": "application/x-subrip" },
      });
    return mediaResponse(url, "not found", { status: 404 });
  }) as typeof fetch;

  return () => {
    globalThis.fetch = realFetch;
  };
}
