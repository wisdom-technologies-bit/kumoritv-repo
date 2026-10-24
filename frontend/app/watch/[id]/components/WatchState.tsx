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

type Server = {
  id: string;
  label?: string;
  type?: string;
  healthy?: boolean;
  hardsub?: boolean;
};
type WatchData = {
  servers?: Server[];
  provider?: string;
  stream?: any;
  source?: any;
  subtitles?: any[];
  hardsub?: boolean;
  thumbnails?: any;
  availableAudio?: { sub?: boolean; dub?: boolean };
};
type State = {
  audio: "sub" | "dub";
  selectedServer: string;
  servers: Server[];
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
  tryNextServer: (reason?: string) => void;
  retry: () => void;
  failover: (reason?: string) => void;
  setSubtitleLanguage: (value: string) => void;
  setOffset: (value: number) => void;
};
const Context = createContext<State | null>(null);
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
  const [selectedServer, setSelectedServer] = useState("auto");
  const [data, setData] = useState<WatchData | null>(null);
  const [status, setStatus] = useState<State["status"]>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [tried, setTried] = useState<string[]>([]);
  const [subtitleLanguage, setSubtitleLanguageState] = useState(
    initialSubtitleLanguage,
  );
  const [offset, setOffsetState] = useState(0);
  const [nonce, setNonce] = useState(0);
  const dead = useRef(new Set<string>());
  const load = useCallback(
    async (provider = selectedServer, exclude: string[] = []) => {
      setStatus("loading");
      const query = new URLSearchParams({ audio, sublang: subtitleLanguage });
      if (provider !== "auto") query.set("provider", provider);
      if (exclude.length) query.set("exclude", exclude.join(","));
      try {
        const response = await fetch(
          `/api/watch/${anilistId}/${episode}?${query}`,
          { cache: "no-store" },
        );
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "stream_error");
        setData(body);
        for (const s of body.servers || [])
          if (s.healthy === false) dead.current.add(s.id);
        setStatus("ready");
        setErrorMessage("");
      } catch (error) {
        setStatus("error");
        setErrorMessage(
          error instanceof Error ? error.message : "stream_error",
        );
      }
    },
    [anilistId, episode, audio, subtitleLanguage, selectedServer],
  );
  useEffect(() => {
    try {
      setSelectedServer(
        localStorage.getItem(`kumori_server_pref_v1:${anilistId}:${audio}`) ||
          "auto",
      );
      setOffsetState(
        Number(localStorage.getItem(`kumori_sub_offset_v1:${anilistId}`) || 0),
      );
    } catch {}
  }, [anilistId, audio]);
  useEffect(() => {
    void load();
  }, [load, nonce]);
  const selectServer = (id: string) => {
    setSelectedServer(id);
    try {
      const key = `kumori_server_pref_v1:${anilistId}:${audio}`;
      id === "auto"
        ? localStorage.removeItem(key)
        : localStorage.setItem(key, id);
    } catch {}
  };
  const tryNextServer = (reason = "network") => {
    const current = data?.provider;
    const next = (data?.servers || []).find(
      (server) => server.id !== current && server.healthy !== false,
    );
    if (!next) return;
    if (current)
      void fetch("/api/watch/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          anilistId,
          episode,
          audio,
          provider: current,
          reason,
        }),
      });
    setTried((value) => [...value, current || ""]);
    selectServer(next.id);
  };
  const latest = useRef({ data, tried });
  latest.current = { data, tried };
  const failover = (reason = "network") => {
    const current = latest.current.data?.provider;
    if (!current) return;
    void fetch("/api/watch/report", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ anilistId, episode, audio, provider: current, reason }),
    }).catch(() => undefined);
    const next = [...latest.current.tried, current];
    setTried(next);
    void load("auto", next);
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
  const value = useMemo(
    () => ({
      audio,
      selectedServer,
      servers: (data?.servers || []).map((s) =>
        dead.current.has(s.id) || tried.includes(s.id)
          ? { ...s, healthy: false }
          : s,
      ),
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
      tryNextServer,
      failover,
      retry: () => setNonce((value) => value + 1),
      setSubtitleLanguage,
      setOffset,
    }),
    [
      audio,
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
