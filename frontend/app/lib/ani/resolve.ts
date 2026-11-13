import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/app/lib/supabase/database.types";
import { probeStream } from "@/app/lib/watch/probe";
import { aniConfig, aniRolloutAllows, type AniConfig } from "./config";
import { getAniStream, recordAniOutcome } from "./client";
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

  const finish = (
    winner: AniWinner | null,
    reason: AniReason | null,
    ms: number,
  ): AniResolveOutcome => {
    recordAniOutcome({
      outcome: winner ? "ok" : "failed",
      ...(reason ? { reason } : {}),
      ms,
    });
    // Only a reason code, the anilist id, the episode and a duration. Never the
    // key, never a URL, never an upstream body.
    console.info(
      `[ani] outcome=${winner ? "ok" : "failed"} reason=${reason ?? "none"} anilist=${input.anilistId} episode=${input.episode} ms=${ms}`,
    );
    return { winner, reason, ms };
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

  const winner = buildAniWinner(result.stream, input.sublang);
  if (!winner) return finish(null, "invalid_body", Date.now() - started);

  // Our own probe of the first segment, exactly like an Anivexa candidate: a
  // stream we cannot fetch is not a stream.
  const probe = await probeStream(winner.stream, winner.headers, {
    timeoutMs: 8_000,
  });
  if (!probe.ok) return finish(null, "probe_failed", Date.now() - started);

  return finish(winner, null, Date.now() - started);
}
