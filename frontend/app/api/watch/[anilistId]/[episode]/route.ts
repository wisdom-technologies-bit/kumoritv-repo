import { waitUntil } from "@vercel/functions";
import { ANIVEXA_BASE } from "@/app/lib/anivexa/client";
import { createAdminClient } from "@/app/lib/supabase/admin";
import { getWatchEpisodeResult } from "@/app/lib/watch/episode-data";
import { importAnime } from "@/app/lib/anime-db/import";
import { proxyUrl, ProxyNotConfiguredError } from "@/app/lib/proxy/signing";
import { normalizeSubtitles } from "@/app/lib/watch/subtitles";
import { normalizeIntroOutro } from "@/app/lib/watch/intro";
import { qualifyStream } from "@/app/lib/watch/qualify";
import {
  normalizeProviderStreams,
  buildServerButtons,
  activeServerId,
  toServerList,
} from "@/app/lib/watch/streams";
import { streamRequestHeaders, DEFAULT_UA } from "@/app/lib/watch/headers";
import { probeStream } from "@/app/lib/watch/probe";
import { providerRank } from "@/app/lib/watch/order";

const IS_VERCEL = process.env.VERCEL === "1";

async function runBackground(task: PromiseLike<any>) {
  const promise = Promise.resolve(task).then((result) => {
    if (result?.error) {
      console.error("[WATCH] Background database update failed:", result.error);
    }
    return result;
  });

  if (IS_VERCEL) {
    waitUntil(
      promise.catch((error) => {
        console.error("[WATCH] Background task failed:", error);
      }),
    );
    return;
  }

  try {
    await promise;
  } catch (error) {
    console.error("[WATCH] Background task failed:", error);
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const cache = new Map<string, { at: number; value: any }>();
function watchCacheKey(input: {
  id: string | number;
  episode: string | number;
  provider?: string | null;
  server?: string | null;
  exclude?: string[];
  audio: string;
  sublang: string;
}) {
  return [
    input.id,
    input.episode,
    input.provider || "",
    input.server || "",
    input.exclude?.join(",") || "",
    input.audio,
    input.sublang.trim().toLowerCase(),
  ].join("-");
}
const hits = new Map<string, number[]>();
const json = (body: any, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "private, max-age=60",
    },
  });
function valid(id: string, max: number) {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 && n < max ? n : null;
}
async function resolveProvider(
  provider: string,
  entry: any,
  audio: string,
  exclude: string[],
  trace: any[],
  requestedServer?: string | null,
) {
  const started = Date.now();
  try {
    const endpoint = new URL(
      String(entry.episodeId).replace(/^\/+/, ""),
      `${ANIVEXA_BASE.replace(/\/+$/, "")}/`,
    ).toString();
    const response = await fetch(endpoint, {
      headers: { "user-agent": DEFAULT_UA },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw Error(`upstream_${response.status}`);
    const upstream = await response.json();
    // One normaliser for every provider shape (streams[], streams+embeds,
    // mkissa sources[]). An unknown shape yields no candidates instead of a
    // crash.
    const streams = normalizeProviderStreams(upstream);
    const qualified = streams.filter(
      (s: any) => qualifyStream(s, { audio, provider, exclude }).ok,
    );
    const candidates = qualified.sort(
      (a: any, b: any) =>
        Number(requestedServer && b.server === requestedServer) -
          Number(requestedServer && a.server === requestedServer) ||
        Number(b.isActive === true) - Number(a.isActive === true) ||
        Number(b.priority || 0) - Number(a.priority || 0) ||
        Number(a.index || 0) - Number(b.index || 0),
    );
    const seen = new Set<string>();
    for (const stream of candidates) {
      const key = String(stream.server || "").toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const headers = streamRequestHeaders(stream);
      const probe = await probeStream(stream, headers);
      trace.push({
        provider,
        server: stream.server,
        type: stream.type,
        probe: probe.segments || null,
        failures: probe.failures || 0,
      });
      if (
        probe.ok ||
        (probe.unstable &&
          !candidates.some((candidate: any) => candidate !== stream))
      ) {
        trace.push({
          provider,
          ms: Date.now() - started,
          outcome: "success",
          server: stream.server,
          type: stream.type,
        });
        return {
          provider,
          server: stream.server,
          stream,
          json: upstream,
          headers,
          embedOnly: !!probe.embedOnly,
        };
      }
    }
    trace.push({
      provider,
      ms: Date.now() - started,
      outcome: "failed",
      reason: qualified.length ? "probe_failed" : "no_qualified_stream",
    });
    return null;
  } catch (error) {
    trace.push({
      provider,
      ms: Date.now() - started,
      outcome: "failed",
      reason: error instanceof Error ? error.message : "network_error",
    });
    return null;
  }
}
export async function GET(
  request: Request,
  { params }: { params: { anilistId: string; episode: string } },
) {
  const id = valid(params.anilistId, 1e9),
    episode = valid(params.episode, 10000),
    url = new URL(request.url),
    audio = url.searchParams.get("audio") || "sub",
    sublang = url.searchParams.get("sublang") || "en",
    exclude = (url.searchParams.get("exclude") || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    refresh = url.searchParams.get("refresh") === "1",
    debug = url.searchParams.get("debug") === "1",
    requestedProvider = url.searchParams.get("provider"),
    requestedServer = url.searchParams.get("server");
  if (!id || !episode) return json({ error: "invalid_episode" }, 400);
  if (!["sub", "dub"].includes(audio))
    return json({ error: "invalid_audio" }, 400);
  const ip = (request.headers.get("x-forwarded-for") || "unknown")
      .split(",")[0]
      .trim(),
    now = Date.now(),
    recent = (hits.get(ip) || []).filter((t) => now - t < 60000);
  if (recent.length >= 40) return json({ error: "rate_limited" }, 429);
  recent.push(now);
  hits.set(ip, recent);
  const key = watchCacheKey({
      id,
      episode,
      provider: requestedProvider,
      server: requestedServer,
      exclude,
      audio,
      sublang,
    }),
    cached = cache.get(key);
  if (!refresh && !debug && cached && now - cached.at < 300000)
    return json(cached.value);
  const db: any = createAdminClient();
  if (!db) return json({ error: "database_unavailable" }, 500);
  let { data: row } = await getWatchEpisodeResult(db, id, episode);
  if (!row) {
    await importAnime(id, { source: "open", timeoutMs: 20000 });
    ({ data: row } = await getWatchEpisodeResult(db, id, episode));
  }
  if (!row) return json({ error: "episode_not_found" }, 404);
  const allProviders = Array.isArray(row[`${audio}_providers`])
    ? row[`${audio}_providers`]
    : [];
  if (
    requestedProvider &&
    !allProviders.some((p: any) => p.provider === requestedProvider)
  )
    return json({ error: "unknown_provider" }, 400);
  const providers = allProviders.filter(
    (p: any) => !requestedProvider || p.provider === requestedProvider,
  );
  if (!providers.length) {
    const availableAudio = ["sub", "dub"].filter(
      (a) =>
        Array.isArray(row[`${a}_providers`]) && row[`${a}_providers`].length,
    );
    return json({ error: "no_providers", availableAudio }, 404);
  }
  const trace: any[] = [];
  let winner: any = null;
  const fast =
    !refresh &&
    row.resolved_provider &&
    row.resolved_audio === audio &&
    row.resolved_at &&
    now - new Date(row.resolved_at).getTime() < 21600000 &&
    !exclude.includes(row.resolved_provider);
  if (fast) {
    const found = providers.find(
      (p: any) => p.provider === row.resolved_provider,
    );
    if (found)
      winner = await resolveProvider(
        found.provider,
        found,
        audio,
        exclude,
        trace,
        requestedServer,
      );
  }
  if (!winner) {
    const ordered = [...providers]
      .filter((p: any) => !exclude.includes(p.provider))
      .sort(
        (a: any, b: any) => providerRank(a.provider) - providerRank(b.provider),
      );
    const results = await Promise.all(
      ordered
        .slice(0, 6)
        .map((p: any) =>
          resolveProvider(
            p.provider,
            p,
            audio,
            exclude,
            trace,
            requestedServer,
          ),
        ),
    );
    const nonEmbed = results.find((r) => r && !r.embedOnly);
    winner = nonEmbed || results.find(Boolean);
  }
  if (!winner) {
    await runBackground(
      db
        .from("episodes")
        .update({
          needs_resync: true,
          resync_requested_at: new Date().toISOString(),
        })
        .eq("play_id", row.play_id),
    );
    return json(
      {
        error: "no_playable_stream",
        tried: trace.map((x) => ({
          provider: x.provider,
          reason: x.reason || x.outcome,
        })),
      },
      502,
    );
  }
  const stream = winner.stream,
    normalized = normalizeSubtitles(
      stream.subtitles,
      winner.json.subtitles,
      sublang,
    ),
    subs = normalized.subtitles,
    intro = normalizeIntroOutro(winner.json, stream),
    availableAudio = ["sub", "dub"].filter(
      (a) =>
        Array.isArray(row[`${a}_providers`]) && row[`${a}_providers`].length,
    );
  // The UI only ever shows SERVER names, one button per distinct name, from
  // the provider that actually resolved. Other providers stay silent backups.
  const winnerStreams = normalizeProviderStreams(winner.json);
  const buttons = buildServerButtons(winnerStreams, { requestedServer });
  const activeId = activeServerId(buttons, stream) || buttons[0]?.id || "";
  const servers = toServerList(buttons, activeId);
  // A backup exists while another provider for this audio has not been tried.
  const hasBackup = allProviders.some(
    (p: any) => p.provider !== winner.provider && !exclude.includes(p.provider),
  );
  let result: any = {
    anilistId: id,
    episode,
    audio,
    provider: winner.provider,
    server: winner.server,
    serverId: activeId,
    hasBackup,
    type: stream.type,
    url: null,
    subtitles: [],
    thumbnails: null,
    intro: intro.intro,
    outro: intro.outro,
    availableAudio,
    servers,
    resolvedAt: new Date().toISOString(),
  };
  try {
    if (stream.type === "embed")
      result.embedUrl = stream.embedUrl || stream.url;
    else {
      result.url = await proxyUrl(
        stream.type === "hls" ? "manifest" : "segment",
        {
          u: stream.url,
          h: winner.headers,
          ...(stream.type === "mp4" ? { f: "mp4" } : {}),
        },
      );
      result.thumbnails = normalized.thumbnails
        ? {
            url: await proxyUrl("thumbnailvtt", {
              u: normalized.thumbnails.upstreamUrl,
              h: winner.headers,
              f: "vtt",
            }),
          }
        : null;
      result.subtitles = await Promise.all(
        subs.map(async (s: any) => ({
          ...s,
          url: await proxyUrl("subtitle", {
            u: s.url,
            h: winner.headers,
            f: "vtt",
          }),
        })),
      );
    }
  } catch (error) {
    if (error instanceof ProxyNotConfiguredError && !result.embedUrl)
      return json({ error: "proxy_not_configured" }, 500);
    throw error;
  }
  await runBackground(
    db
      .from("episodes")
      .update({
        resolved_provider: winner.provider,
        resolved_audio: audio,
        resolved_at: new Date().toISOString(),
        needs_resync: false,
      })
      .eq("play_id", row.play_id),
  );
  if (debug) {
    result.trace = trace;
  } else {
    cache.set(key, { at: now, value: result });
  }
  return json(result);
}
