import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/app/lib/supabase/database.types";
import { probeStream } from "@/app/lib/watch/probe";
import { aniConfig, aniRolloutAllows, type AniConfig } from "./config";
import { getAniStream, positiveTtlMs, recordAniOutcome } from "./client";
import { ANI_PROVIDER } from "./constants";
import type { AniReason } from "./errors";
import { buildAniWinner, type AniWinner } from "./stream";

/**
 * "Should ani even be asked?" - decided before any database or network work, so
 * a disabled provider costs nothing at all.
 */
export type AniGateInput = {
  anilistId: number;
  audio: "sub" | "dub";
  requestedProvider?: string | null;
  exclude?: string[];
  config?: AniConfig;
};

export type AniGate =
  | { attempt: true }
  | { attempt: false; reason: AniReason };

export function aniGate(input: AniGateInput): AniGate {
  const config = input.config ?? aniConfig();
  if (!config.enabled) return { attempt: false, reason: "disabled" };
  if (!config.baseUrl || !config.apiKey)
    return { attempt: false, reason: "not_configured" };
  if (input.requestedProvider && input.requestedProvider !== ANI_PROVIDER)
    return { attempt: false, reason: "provider_pinned" };
  if ((input.exclude || []).includes(ANI_PROVIDER))
    return { attempt: false, reason: "excluded" };
  // Audio language is only DECLARED by the API, never verified, so dub stays off
  // until the owner has checked it by ear.
  if (input.audio === "dub" && !config.dubEnabled)
    return { attempt: false, reason: "audio_unsupported" };
  if (!aniRolloutAllows(input.anilistId, config))
    return { attempt: false, reason: "percent_out" };
  return { attempt: true };
}

/**
 * `anime.mal_id` is the only MAL id this app stores (the episodes row has none),
 * and it is written by the importer from AniList's `idMal`.
 */
export async function lookupMalId(
  db: SupabaseClient<Database> | null,
  anilistId: number | string,
): Promise<number | null> {
  if (!db) return null;
  try {
    const { data } = await db
      .from("anime")
      .select("mal_id")
      .eq("anilist_id", anilistId)
      .maybeSingle();
    const value = Number((data as { mal_id?: unknown } | null)?.mal_id);
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export type AniResolveOutcome = {
  winner: AniWinner | null;
  reason: AniReason | null;
  ms: number;
  /** Which upstream source answered, when one did. */
  provider: string | null;
};

/**
 * Resolve an ani stream into the winner shape, or explain (in reason codes) why
 * not. It never throws: every failure is a reason the caller can fall through on.
 */
export async function resolveAni(input: {
  anilistId: number;
  episode: number;
  audio: "sub" | "dub";
  malId: number | null;
  refresh: boolean;
  sublang: string;
}): Promise<AniResolveOutcome> {
  const started = Date.now();
  const config = aniConfig();

  const finish = (
    winner: AniWinner | null,
    reason: AniReason | null,
    ms: number,
    provider?: string | null,
  ): AniResolveOutcome => {
    recordAniOutcome({
      outcome: winner ? "ok" : "failed",
      provider: String(provider || "").trim().toLowerCase() || undefined,
      ...(reason ? { reason } : {}),
      ms,
    });
    // Only a reason code, the source name, the anilist id, the episode and a
    // duration. Never the key, never a URL, never an upstream body.
    console.info(
      `[ani] outcome=${winner ? "ok" : "failed"} provider=${provider ?? "none"} reason=${reason ?? "none"} anilist=${input.anilistId} episode=${input.episode} ms=${ms}`,
    );
    return { winner, reason, ms, provider: provider ?? null };
  };

  if (!input.malId)
    return finish(null, "no_mal_id", Date.now() - started);

  const result = await getAniStream({
    malId: input.malId,
    episode: input.episode,
    audio: input.audio,
    refresh: input.refresh,
  });
  if (!result.ok) return finish(null, result.reason, result.ms);

  const provider = String(result.stream.provider || "").trim().toLowerCase();

  // Per-provider rule: some AniKoto episodes return ZERO subtitle tracks. That
  // may mean hard-subbed, or "no English subtitles at all" - the API cannot tell.
  // ANI_ANIKOTO_REQUIRE_SUBTITLE (default 1) refuses them for SUB so nothing
  // risky goes live; the owner flips it to 0 after checking by eye.
  const trackCount = Array.isArray(result.stream.subtitles)
    ? result.stream.subtitles.length
    : 0;
  if (
    provider === "anikoto" &&
    config.requireAnikotoSubtitle &&
    input.audio === "sub" &&
    trackCount === 0
  )
    return finish(null, "anikoto_no_subtitles", Date.now() - started, provider);

  const winner = buildAniWinner(result.stream, input.sublang);
  if (!winner)
    return finish(null, "invalid_body", Date.now() - started, provider);

  // Our own probe of the first segment, exactly like an Anivexa candidate: a
  // stream we cannot fetch is not a stream.
  const probe = await probeStream(winner.stream, winner.headers, {
    timeoutMs: 8_000,
  });
  if (!probe.ok)
    return finish(null, "probe_failed", Date.now() - started, provider);

  // The cache TTL is decided in the client; expose it so the watch route can cap
  // its own response cache the same way (AniKoto: 15 minutes, never longer).
  void positiveTtlMs(result.stream);

  return finish(winner, null, Date.now() - started, provider);
}
