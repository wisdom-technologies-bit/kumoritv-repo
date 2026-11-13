/**
 * Boots the real watch route against the local stand-ins.
 *
 * Environment has to be in place before the route module is imported (Anivexa's
 * base URL is a module constant), so this module sets it and then imports the
 * handler dynamically. Every ani setting is read per request, so a test can
 * still flip `ANI_PROVIDER_ENABLED`, `ANI_PROVIDER_PERCENT` or `ANI_DUB_ENABLED`
 * between calls without re-importing anything.
 */
import { installMediaFetch, startStandin, type Standin } from "./standin";
import { normaliseWatchResponse } from "./normalise";

export const TEST_ANI_KEY = "test-key-SENTINEL-never-print";
export const ANIVEXA_PROVIDER = "anikoto";

export const EPISODE_ROW = {
  play_id: "21-1",
  anilist_id: 21,
  episode_number: 1,
  title: "I'm Luffy! The Man Who's Gonna Be King of the Pirates!",
  sub_providers: [{ provider: ANIVEXA_PROVIDER, episodeId: "ep/21-1" }],
  dub_providers: [{ provider: ANIVEXA_PROVIDER, episodeId: "ep/21-1" }],
  resolved_provider: null as string | null,
  resolved_audio: null as string | null,
  resolved_at: null as string | null,
  needs_resync: false,
};

export type WatchHarness = {
  standin: Standin;
  call: (
    query?: Record<string, string | undefined>,
    overrides?: { ip?: string; anilistId?: string; episode?: string },
  ) => Promise<{ status: number; body: any; normalised: any }>;
  reset: () => Promise<void>;
  close: () => Promise<void>;
};

export async function startWatchHarness(): Promise<WatchHarness> {
  // supabase-js refuses to build its Realtime client without a WebSocket on this
  // node version. The watch route never uses realtime, so an inert stub is
  // enough to let the real admin client be constructed against the stand-in.
  if (!("WebSocket" in globalThis)) (globalThis as any).WebSocket = class {};
  const standin = await startStandin();
  const restoreMedia = installMediaFetch();

  process.env.ANI_API_BASE_URL = standin.url;
  process.env.ANI_API_KEY = TEST_ANI_KEY;
  process.env.ANI_PROVIDER_ENABLED = "0";
  process.env.ANI_PROVIDER_PERCENT = "100";
  process.env.ANI_DUB_ENABLED = "0";
  process.env.ANIVEXA_BASE_URL = standin.url;
  process.env.NEXT_PUBLIC_SUPABASE_URL = standin.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "standin-service-key";
  process.env.PROXY_SIGNING_SECRET = "standin-proxy-secret";

  standin.state.episodes[EPISODE_ROW.play_id] = EPISODE_ROW;
  standin.state.anime[String(EPISODE_ROW.anilist_id)] = { mal_id: 21 };
  // A second title that Anivexa has never seen (no provider rows at all).
  standin.state.episodes["22-1"] = {
    ...EPISODE_ROW,
    play_id: "22-1",
    anilist_id: 22,
    sub_providers: [],
    dub_providers: [],
  };
  standin.state.anime["22"] = { mal_id: 21 };

  // `@/` aliases resolve through tsconfig, exactly as the app imports them.
  const { GET } = await import("@/app/api/watch/[anilistId]/[episode]/route");

  let counter = 0;
  const call: WatchHarness["call"] = async (query = {}, overrides = {}) => {
    counter++;
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query))
      if (value !== undefined) search.set(key, value);
    const anilistId = overrides.anilistId ?? "21";
    const episode = overrides.episode ?? "1";
    const response = await GET(
      new Request(`http://localhost/api/watch/${anilistId}/${episode}?${search.toString()}`, {
        // A fresh address per call keeps the per-IP limit out of the way.
        headers: {
          "x-forwarded-for":
            overrides.ip ?? `10.9.${counter % 250}.${(counter * 7) % 250}`,
        },
      }),
      { params: { anilistId, episode } },
    );
    const body = await response.json();
    return {
      status: response.status,
      body,
      normalised: normaliseWatchResponse(body),
    };
  };

  const reset = async () => {
    // Imported here so this harness still boots against a tree without
    // app/lib/ani (the master worktree used for the reference snapshot).
    const { __resetAniStateForTests } = await import("@/app/lib/ani/client");
    __resetAniStateForTests();
    standin.state.aniMode = "ok";
    standin.state.aniCalls = [];
    standin.state.anivexaCalls = 0;
    standin.state.delayMs = 0;
    standin.state.episodePatches = [];
    process.env.ANI_PROVIDER_ENABLED = "0";
    process.env.ANI_PROVIDER_PERCENT = "100";
    process.env.ANI_DUB_ENABLED = "0";
  };

  return {
    standin,
    call,
    reset,
    close: async () => {
      restoreMedia();
      await standin.close();
    },
  };
}
