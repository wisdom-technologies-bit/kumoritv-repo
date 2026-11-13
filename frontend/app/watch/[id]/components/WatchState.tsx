"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ANI_PROVIDER } from "@/app/lib/ani/constants";

// The UI only ever talks about SERVER names. `provider` stays internal (it is
// never rendered); it is what the route uses to exclude a dead source.
type Server = {
  id: string;
  label?: string;
  active?: boolean;
  healthy?: boolean;
};
type WatchData = {
  servers?: Server[];
  provider?: string;
  server?: string;
  serverId?: string;
  hasBackup?: boolean;
  stream?: any;
  source?: any;
  subtitles?: any[];
  hardsub?: boolean;
  thumbnails?: any;
  availableAudio?: string[] | { sub?: boolean; dub?: boolean };
};
type LoadOptions = {
  provider?: string | null;
  server?: string | null;
  exclude?: string[];
  /** Force a fresh upstream resolve (`refresh=1`): bypasses both caches. */
  refresh?: boolean;
};
type State = {
  audio: "sub" | "dub";
  servers: Server[];
  activeServerId: string;
  selectedServer: string;
  hasBackup: boolean;
  activeProvider: string;
  availableAudio: { sub?: boolean; dub?: boolean };
  status: "loading" | "ready" | "error";
  errorMessage: string;
  tried: string[];
  hardsub: boolean;
  subtitles: any[];
  thumbnails?: any;
  data: WatchData | null;
  subtitleLanguage: string;
  offset: number;
  setAudio: (audio: "sub" | "dub") => void;
  selectServer: (id: string) => void;
  backupServer: () => void;
  tryNextServer: (reason?: string) => void;
  retry: () => void;
  failover: (reason?: string) => void;
  setSubtitleLanguage: (value: string) => void;
  setOffset: (value: number) => void;
};
const Context = createContext<State | null>(null);

type ServerPref = { server: string; provider: string };

const prefKey = (anilistId: number, audio: string) =>
  `kumori_server_pref_v1:${anilistId}:${audio}`;

/** Stored as { server label, internal provider key }; older plain values reset. */
export function readServerPref(
  anilistId: number,
  audio: string,
): ServerPref | null {
  try {
    const raw = localStorage.getItem(prefKey(anilistId, audio));
    if (!raw || raw === "auto") return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const server = typeof parsed.server === "string" ? parsed.server : "";
    const provider = typeof parsed.provider === "string" ? parsed.provider : "";
    return server || provider ? { server, provider } : null;
  } catch {
    return null;
  }
}

export function writeServerPref(
  anilistId: number,
  audio: string,
  value: ServerPref | null,
) {
  try {
    const key = prefKey(anilistId, audio);
    if (!value) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export function WatchState({
  anilistId,
  episode,
  initialAudio,
  initialSubtitleLanguage,
  children,
}: {
  anilistId: number;
  episode: number;
  initialAudio: "sub" | "dub";
  initialSubtitleLanguage: string;
  children: React.ReactNode;
}) {
  const [audio, setAudio] = useState(initialAudio);
  const [data, setData] = useState<WatchData | null>(null);
  const [status, setStatus] = useState<State["status"]>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [tried, setTried] = useState<string[]>([]);
  const [selectedServer, setSelectedServer] = useState("");
  const [subtitleLanguage, setSubtitleLanguageState] = useState(
    initialSubtitleLanguage,
  );
  const [offset, setOffsetState] = useState(0);
  const [nonce, setNonce] = useState(0);
  const requestRef = useRef<LoadOptions>({});
  // ani stream URLs were measured valid for about 28 minutes, so the first fatal
  // player error is far more likely to be an expired URL than a dead source.
  // One forced re-resolve is allowed per episode/audio before ani is excluded.
  const aniRefreshTried = useRef(false);

  // `refresh` is per-request on purpose: it must not be replayed by the next
  // failover, only the provider/server/exclude choices are remembered.
  const load = useCallback(
    async (options: LoadOptions = requestRef.current) => {
      requestRef.current = {
        provider: options.provider,
        server: options.server,
        exclude: options.exclude,
      };
      setStatus("loading");
      const query = new URLSearchParams({ audio, sublang: subtitleLanguage });
      if (options.provider) query.set("provider", options.provider);
      if (options.server) query.set("server", options.server);
      if (options.exclude?.length) query.set("exclude", options.exclude.join(","));
      if (options.refresh) query.set("refresh", "1");
      try {
        const response = await fetch(
          `/api/watch/${anilistId}/${episode}?${query}`,
          { cache: "no-store" },
        );
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "stream_error");
        setData(body);
        setStatus("ready");
        setErrorMessage("");
        // A different source took over, so ani gets its one forced retry back.
        if (body?.provider !== ANI_PROVIDER) aniRefreshTried.current = false;
        return true;
      } catch (error) {
        setStatus("error");
        setErrorMessage(
          error instanceof Error ? error.message : "stream_error",
        );
        return false;
      }
    },
    [anilistId, episode, audio, subtitleLanguage],
  );

  useEffect(() => {
    const saved = readServerPref(anilistId, audio);
    setSelectedServer(saved?.server || "");
    // The first request replays the remembered choice (label + provider key).
    requestRef.current = saved
      ? { provider: saved.provider || null, server: saved.server || null }
      : {};
    try {
      setOffsetState(
        Number(localStorage.getItem(`kumori_sub_offset_v1:${anilistId}`) || 0),
      );
    } catch {}
  }, [anilistId, audio]);

  useEffect(() => {
    void load();
  }, [load, nonce]);

  useEffect(() => {
    aniRefreshTried.current = false;
  }, [anilistId, episode, audio]);

  /** Picking a server keeps the active provider and asks for that label. */
  const selectServer = (id: string) => {
    const server = (data?.servers || []).find((item) => item.id === id);
    if (!server) return;
    const label = server.label || server.id;
    setSelectedServer(id);
    // Remember the choice with the internal provider key it belonged to.
    writeServerPref(
      anilistId,
      audio,
      data?.provider ? { server: label, provider: data.provider } : null,
    );
    void load({ provider: data?.provider || null, server: label });
  };

  const reportDead = (provider: string | undefined, reason: string) => {
    if (!provider) return;
    void fetch("/api/watch/report", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ anilistId, episode, audio, provider, reason }),
    }).catch(() => undefined);
  };

  /** "Backup server": ask the route for the next provider, silently. */
  const backupServer = () => {
    const current = data?.provider;
    if (!current) return;
    const exclude = [...new Set([...(requestRef.current.exclude || []), current])];
    reportDead(current, "manual_backup");
    setSelectedServer("");
    writeServerPref(anilistId, audio, null);
    setTried(exclude);
    void load({ provider: null, server: null, exclude });
  };

  /**
   * ani first gets ONE forced re-resolve (`refresh=1`, same provider, position
   * kept), because its URLs expire long before the session does. Only if that
   * fails - or the fresh stream fails too - is ani excluded and Anivexa asked.
   * Every other provider keeps the old behaviour: exclude and move on.
   */
  const refreshAniThenFallback = async () => {
    const refreshed = await load({
      provider: ANI_PROVIDER,
      server: null,
      refresh: true,
    });
    if (refreshed) return;
    const exclude = [
      ...new Set([...(requestRef.current.exclude || []), ANI_PROVIDER]),
    ];
    setSelectedServer("");
    setTried(exclude);
    writeServerPref(anilistId, audio, null);
    await load({ provider: null, server: null, exclude });
  };

  const failover = (reason = "network") => {
    const current = data?.provider;
    if (!current) return;
    reportDead(current, reason);
    if (current === ANI_PROVIDER && !aniRefreshTried.current) {
      aniRefreshTried.current = true;
      void refreshAniThenFallback();
      return;
    }
    const exclude = [...new Set([...(requestRef.current.exclude || []), current])];
    setSelectedServer("");
    setTried(exclude);
    void load({ provider: null, server: null, exclude });
  };

  const setSubtitleLanguage = (value: string) => {
    setSubtitleLanguageState(value);
    try {
      localStorage.setItem(`kumori_subtitle_language_v1:${anilistId}`, value);
      document.cookie = `subtitle_language=${encodeURIComponent(value)}; path=/; max-age=31536000`;
    } catch {}
  };
  const setOffset = (value: number) => {
    setOffsetState(value);
    try {
      localStorage.setItem(`kumori_sub_offset_v1:${anilistId}`, String(value));
    } catch {}
  };

  const servers = (data?.servers || []).map((server) => ({
    ...server,
    active: server.id === (data?.serverId || ""),
  }));
  const activeServerId =
    data?.serverId ||
    servers.find((server) => server.active)?.id ||
    servers[0]?.id ||
    "";

  const value = useMemo(
    () => ({
      audio,
      servers,
      activeServerId,
      selectedServer,
      hasBackup: Boolean(data?.hasBackup),
      activeProvider: data?.provider || "",
      availableAudio: (() => {
        const raw: any = data?.availableAudio;
        if (Array.isArray(raw))
          return { sub: raw.includes("sub"), dub: raw.includes("dub") };
        if (raw && typeof raw === "object") return raw;
        return { sub: true, dub: true };
      })(),
      status,
      errorMessage,
      tried,
      hardsub: Boolean(data?.hardsub),
      subtitles: data?.subtitles || data?.stream?.subtitles || [],
      thumbnails: data?.thumbnails,
      data,
      subtitleLanguage,
      offset,
      setAudio,
      selectServer,
      backupServer,
      tryNextServer: backupServer,
      failover,
      retry: () => setNonce((value) => value + 1),
      setSubtitleLanguage,
      setOffset,
    }),
    [
      audio,
      servers,
      activeServerId,
      selectedServer,
      data,
      status,
      errorMessage,
      tried,
      subtitleLanguage,
      offset,
    ],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useWatchState() {
  const value = useContext(Context);
  if (!value) throw new Error("useWatchState must be used inside WatchState");
  return value;
}

/**
 * Prompt 35: the same value, but null outside the provider instead of throwing.
 * The player toolbar also renders on its own (a few standalone surfaces and the
 * layout tests render it directly), and a missing provider must not crash it.
 */
export function useWatchStateOptional() {
  return useContext(Context);
}
