"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MediaPlayer, MediaProvider, Track } from "@vidstack/react";
import {
  DefaultVideoLayout,
  defaultLayoutIcons,
} from "@vidstack/react/player/layouts/default";
import "@vidstack/react/player/styles/default/theme.css";
import "@vidstack/react/player/styles/default/layouts/video.css";
import styles from "./component.module.css";
import {
  getProgress,
  saveProgress,
  shouldMarkFirstSave,
  shouldResume,
} from "@/app/lib/local-store/progress";
import {
  mergeSkipRanges,
  shouldAutoSkip,
  visibleSkipRange,
  skipLabel,
} from "@/app/lib/watch/skip";
import { usePrefs } from "@/app/lib/user-data/prefs";
import { useWatchState } from "../WatchState";

const HLS_CONFIG = {
  autoStartLoad: true,
  startFragPrefetch: true,
  capLevelToPlayerSize: true,
  startLevel: -1,
  maxBufferLength: 60,
  maxMaxBufferLength: 120,
  maxBufferHole: 0.5,
  backBufferLength: 30,
  enableWorker: true,
  lowLatencyMode: false,
  enableCEA708Captions: true,
  enableWebVTT: true,
  enableIMSC1: true,
  fragLoadPolicy: {
    default: {
      maxTimeToFirstByteMs: 4000,
      maxLoadTimeMs: 60000,
      timeoutRetry: { maxNumRetry: 0, retryDelayMs: 0, maxRetryDelayMs: 0 },
      errorRetry: { maxNumRetry: 1, retryDelayMs: 0, maxRetryDelayMs: 0 },
    },
  },
  playlistLoadPolicy: {
    default: {
      maxTimeToFirstByteMs: 10000,
      maxLoadTimeMs: 60000,
      timeoutRetry: { maxNumRetry: 4, retryDelayMs: 0, maxRetryDelayMs: 0 },
      errorRetry: { maxNumRetry: 4, retryDelayMs: 500, maxRetryDelayMs: 4000 },
    },
  },
  manifestLoadPolicy: {
    default: {
      maxTimeToFirstByteMs: 10000,
      maxLoadTimeMs: 60000,
      timeoutRetry: { maxNumRetry: 4, retryDelayMs: 0, maxRetryDelayMs: 0 },
      errorRetry: { maxNumRetry: 4, retryDelayMs: 500, maxRetryDelayMs: 4000 },
    },
  },
};
type Props = {
  anilistId: number;
  episode: number;
  audio: "sub" | "dub";
  subtitleLanguage: string;
  initialTime: number;
  title: string;
  provider?: string;
  /** Episode thumbnail (episodes table / getEpisodeSeo) for Keep Watching. */
  episodeImage?: string;
  /** Anime cover, stored with the progress as the second fallback. */
  cover?: string;
  /** Next episode number, when one actually exists (auto-next). */
  nextEpisode?: number | null;
  onResolved?: (data: any) => void;
};

export default function VideoPlayer({
  anilistId,
  episode,
  audio,
  subtitleLanguage,
  initialTime,
  title,
  provider,
  episodeImage,
  cover,
  nextEpisode,
  onResolved,
}: Props) {
  const playerRef = useRef<any>(null);
  const progressRef = useRef({ time: initialTime, duration: 0 });
  const resumeRef = useRef(false);
  const appliedSubtitleSelectionRef = useRef<string | null>(null);
  const recoveryRef = useRef({
    network: 0,
    media: 0,
    swapped: false,
    switched: false,
  });
  const watch = useWatchState();
  const renders = useRef(0);
  renders.current++;
  const [dbg, setDbg] = useState<string[] | null>(null);
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("dbg")) return;
    setDbg([]);
    let last = 0;
    const iv = setInterval(() => {
      const pl: any = playerRef.current;
      if (!pl) return;
      let tracks = "";
      try {
        tracks = (Array.from(pl.textTracks) as any[])
          .map((t, i) => {
            const act = Array.from(t.activeCues || [])
              .map((c: any) =>
                String(c.text)
                  .replace(/<[^>]+>/g, "")
                  .slice(0, 25),
              )
              .join("/");
            return `#${i}:${t.label}:${t.mode} default=${t.default} cues=${t.cues ? t.cues.length : "null"} act="${act}"`;
          })
          .join(" ; ");
      } catch (e: any) {
        tracks = "err " + e.message;
      }
      const cap = document.querySelector("media-captions, .vds-captions");
      const media = (pl.querySelector?.("video") ||
        document.querySelector("video")) as HTMLVideoElement | null;
      const nativeTrack = media?.textTracks?.[0];
      const nativeTrackElement = (media?.querySelector("track") ||
        document.querySelector("track")) as HTMLTrackElement | null;
      const durationValue = media?.duration ?? pl.state?.duration;
      const duration = Number(durationValue);
      const durationLabel = Number.isFinite(duration)
        ? duration.toFixed(1)
        : String(durationValue ?? "unknown");
      const line = `t=${Number(pl.state?.currentTime ?? 0).toFixed(1)} native-t=${Number(media?.currentTime ?? 0).toFixed(1)} duration=${durationLabel} ready=${media?.readyState ?? "?"} network=${media?.networkState ?? "?"} native-track=${nativeTrack?.mode ?? "?"}/${nativeTrack?.cues?.length ?? "null"}/${nativeTrack?.activeCues?.length ?? 0} default=${nativeTrackElement?.default ?? false} media-error=${media?.error?.code ?? "none"} renders/s=${renders.current - last} paused=${pl.state?.paused} ${tracks} | dom="${(cap?.textContent || "").slice(0, 25)}"`;
      last = renders.current;
      setDbg((all) => [...(all || []).slice(-40), line]);
    }, 1000);
    return () => clearInterval(iv);
  }, []);
  const [playbackError, setPlaybackError] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [aniskipRanges, setAniskipRanges] = useState<any>(null);
  const [duration, setDuration] = useState(0);
  const [visibleSkip, setVisibleSkip] = useState<any>(null);
  const visibleSkipKeyRef = useRef<string | null>(null);
  const skippedRanges = useRef(new Set<string>());
  const router = useRouter();
  const { prefs } = usePrefs();
  const data: any = watch.status === "ready" ? watch.data : null;
  let error = watch.status === "error" ? watch.errorMessage : playbackError;

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/skip/${anilistId}/${episode}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (!controller.signal.aborted) setAniskipRanges(body);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [anilistId, episode]);

  useEffect(() => {
    if (data) onResolved?.(data);
  }, [data]);

  // Provider ranges (per stream, seconds) win over AniSkip; invalid ranges
  // (end <= start, senshi's {0,0}) are dropped by mergeSkipRanges.
  const skipRanges = useMemo(
    () =>
      mergeSkipRanges(
        { intro: data?.intro ?? null, outro: data?.outro ?? null },
        {
          intro: aniskipRanges?.intro ?? null,
          outro: aniskipRanges?.outro ?? null,
          recap: aniskipRanges?.recap ?? null,
        },
        duration || null,
      ),
    [data?.intro, data?.outro, aniskipRanges, duration],
  );

  const stream = data?.stream || data?.source || data;
  const streamType = String(stream?.type || "")
    .trim()
    .toLowerCase();
  const candidateSource = stream?.url || stream?.src;
  const sourceType =
    streamType === "mp4"
      ? ("video/mp4" as const)
      : streamType === "hls"
        ? ("application/x-mpegurl" as const)
        : null;
  const source =
    sourceType && typeof candidateSource === "string" ? candidateSource : null;
  const embedCandidate = stream?.embedUrl || candidateSource;
  const embedSource =
    streamType === "embed" && typeof embedCandidate === "string"
      ? (() => {
          try {
            const url = new URL(embedCandidate.trim());
            return url.protocol === "https:" && !url.username && !url.password
              ? url.toString()
              : null;
          } catch {
            return null;
          }
        })()
      : null;

  if (data && streamType === "embed" && !embedSource && !error) {
    error = "invalid_embed_url";
  } else if (
    data &&
    streamType !== "embed" &&
    (!sourceType || !source) &&
    !error
  ) {
    error = "unsupported_stream_type";
  }

  const sourceId = `${data?.provider || "provider"}:${streamType}:${source || embedSource || ""}`;
  const subtitleOptions = useMemo(
    () =>
      Array.isArray(data?.subtitles)
        ? data.subtitles.filter(
            (track: any) =>
              typeof track?.url === "string" && track.url.trim().length > 0,
          )
        : [],
    [data?.subtitles],
  );
  const normaliseLanguage = (value: unknown) =>
    String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/_/g, "-");
  const preferredLanguage = normaliseLanguage(subtitleLanguage);
  const preferredSubtitleIndex = subtitleOptions.findIndex((track: any) => {
    const lang = normaliseLanguage(track.lang);
    const label = normaliseLanguage(track.label);

    return (
      preferredLanguage !== "" &&
      (lang === preferredLanguage ||
        label === preferredLanguage ||
        lang.startsWith(`${preferredLanguage}-`) ||
        preferredLanguage.startsWith(`${lang}-`) ||
        label.includes(preferredLanguage))
    );
  });
  const englishSubtitleIndex = subtitleOptions.findIndex(
    (track: any) =>
      /\benglish\b/i.test(track.label || "") ||
      /^en(?:[-_]|$)/i.test(track.lang || ""),
  );
  const defaultSubtitleIndex =
    subtitleOptions.length === 0
      ? -1
      : preferredSubtitleIndex >= 0
        ? preferredSubtitleIndex
        : englishSubtitleIndex >= 0
          ? englishSubtitleIndex
          : 0;
  const defaultSubtitleKey =
    defaultSubtitleIndex >= 0
      ? `${sourceId}:${subtitleOptions[defaultSubtitleIndex]?.url || defaultSubtitleIndex}`
      : "";
  const subtitleTracks = useMemo(
    () =>
      subtitleOptions.map((track: any, index: number) => (
        <Track
          key={`${track.url}-${index}`}
          src={track.url}
          kind="subtitles"
          type="vtt"
          label={track.label || track.lang || `Subtitle ${index + 1}`}
          lang={track.lang || "en"}
          default={index === defaultSubtitleIndex}
        />
      )),
    [subtitleOptions, defaultSubtitleIndex],
  );

  // One early save per episode: without it a short visit only reached the server
  // after the 10s tick (or on pause/hide, which a closed tab may skip).
  const firstSaveDoneRef = useRef(false);
  useEffect(() => {
    firstSaveDoneRef.current = false;
  }, [anilistId, episode, audio]);

  const seekTo = (time: number) => {
    const player: any = playerRef.current;
    if (!player) return;
    if (typeof player.remoteControl?.seek === "function")
      player.remoteControl.seek(time);
    else player.currentTime = time;
  };

  const persist = () => {
    const value = progressRef.current;
    if (value.time > 0)
      saveProgress(anilistId, {
        episode,
        time: value.time,
        duration: value.duration,
        audio,
        title,
        // Keep Watching needs the real episode thumbnail; the anime cover is
        // the fallback and is stored alongside it.
        ...(episodeImage ? { episodeImage } : {}),
        ...(cover ? { cover } : {}),
      });
  };
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === "hidden") persist();
    };
    const cleanup = () => persist();
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", cleanup);
    const timer = window.setInterval(persist, 10000);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", cleanup);
      persist();
    };
    // cover and episodeImage belong to the snapshot: without them a metadata
    // arrival after mount was never saved.
  }, [anilistId, episode, audio, title, cover, episodeImage]);
  const canPlay = () => {
    const player = playerRef.current;
    if (!player) return;

    if (
      defaultSubtitleIndex >= 0 &&
      appliedSubtitleSelectionRef.current !== defaultSubtitleKey
    ) {
      const preferredTrack = subtitleOptions[defaultSubtitleIndex];
      const preferredLanguage = normaliseLanguage(preferredTrack?.lang);
      const preferredLabel = normaliseLanguage(
        preferredTrack?.label || preferredTrack?.lang,
      );
      const playerTracks = Array.from(player.textTracks || []) as TextTrack[];
      const matchingTrackIndex = playerTracks.findIndex((candidate) => {
        const language = normaliseLanguage(candidate.language);
        const label = normaliseLanguage(candidate.label);

        return (
          (preferredLanguage !== "" &&
            (language === preferredLanguage ||
              language.startsWith(`${preferredLanguage}-`) ||
              preferredLanguage.startsWith(`${language}-`))) ||
          (preferredLabel !== "" && label === preferredLabel)
        );
      });
      const trackIndex =
        matchingTrackIndex >= 0
          ? matchingTrackIndex
          : defaultSubtitleIndex < playerTracks.length
            ? defaultSubtitleIndex
            : -1;

      if (trackIndex >= 0) {
        const remote = player.remoteControl;
        if (typeof remote?.changeTextTrackMode === "function") {
          remote.changeTextTrackMode(trackIndex, "showing");
        } else {
          playerTracks[trackIndex].mode = "showing";
        }
        appliedSubtitleSelectionRef.current = defaultSubtitleKey;
      }
    }

    if (resumeRef.current) return;
    resumeRef.current = true;
    const saved = getProgress(anilistId);
    const time =
      initialTime ||
      (saved && shouldResume(saved.time, saved.duration) ? saved.time : 0);
    if (time > 0) {
      const remote = player.remoteControl;
      if (typeof remote?.seek === "function") {
        remote.seek(time);
      } else {
        player.currentTime = time;
      }
    }
  };
  const providerSetup = (event: any) => {
    const provider = event.detail;
    if (provider?.type !== "hls") return;
    provider.library = () => import("hls.js");
    provider.config = HLS_CONFIG;
  };
  const providerChange = (provider: any) => {
    const hls = provider?.instance;
    if (!hls?.on) return;
    recoveryRef.current = {
      network: 0,
      media: 0,
      swapped: false,
      switched: false,
    };
    const handleError = (_: string, details: any) => {
      console.warn("[kumori-hls]", details?.type, details?.details);
      if (!details?.fatal) return;
      if (details.type === "networkError" && !recoveryRef.current.switched) {
        recoveryRef.current.switched = true;
        setWaiting(true);
        watch.failover("blocked");
        return;
      }
      if (details.type === "mediaError" && recoveryRef.current.media < 3) {
        recoveryRef.current.media++;
        hls.recoverMediaError?.();
        return;
      }
      if (details.type === "mediaError" && !recoveryRef.current.swapped) {
        recoveryRef.current.swapped = true;
        hls.swapAudioCodec?.();
        hls.recoverMediaError?.();
        return;
      }
      if (!recoveryRef.current.switched) {
        recoveryRef.current.switched = true;
        setWaiting(true);
        watch.failover("blocked");
        return;
      }
      setPlaybackError("stream_recovery_exhausted");
    };
    hls.on("hlsError", handleError);
    return () => hls.off?.("hlsError", handleError);
  };

  return (
    <div className={styles.container}>
      <div
        style={{
          position: "relative",
          aspectRatio: "16 / 9",
          background: "#000",
        }}
      >
        {!data && !error && (
          <img
            src="/assets/Eclipse-1s-200px-custom-color.svg"
            alt="Loading video"
            style={{
              position: "absolute",
              inset: 0,
              margin: "auto",
              width: 72,
              height: 72,
            }}
          />
        )}
        {data && embedSource && (
          <iframe
            key={sourceId}
            className={styles.embedFrame}
            src={embedSource}
            title={`Ep. ${episode} - ${title} embedded video`}
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        )}
        {data && source && sourceType && (
          <MediaPlayer
            ref={playerRef}
            key={sourceId}
            src={{ src: source, type: sourceType }}
            title={`Ep. ${episode} - ${title}`}
            playsInline
            load="eager"
            onProviderSetup={providerSetup}
            onCanPlay={canPlay}
            onTimeUpdate={(event: any) => {
              const media = document.querySelector("video");
              const current = Number(
                event?.detail?.currentTime ??
                  event?.currentTarget?.currentTime ??
                  media?.currentTime ??
                  0,
              );
              const currentDuration = Number(
                event?.currentTarget?.duration ?? media?.duration ?? 0,
              );
              progressRef.current.time = current;
              progressRef.current.duration = Number.isFinite(currentDuration)
                ? currentDuration
                : 0;

              if (shouldMarkFirstSave(current, firstSaveDoneRef.current)) {
                firstSaveDoneRef.current = true;
                persist();
              }

              const next = visibleSkipRange(current, skipRanges);
              const nextKey = next?.key ?? null;
              if (visibleSkipKeyRef.current !== nextKey) {
                visibleSkipKeyRef.current = nextKey;
                setVisibleSkip(next);
              }

              // Auto-skip: seek once per range, never twice.
              if (prefs.autoSkip && next) {
                if (
                  shouldAutoSkip(
                    next.key,
                    skippedRanges.current,
                    next.range,
                    current,
                  )
                ) {
                  skippedRanges.current.add(next.key);
                  seekTo(next.range.end);
                  visibleSkipKeyRef.current = null;
                  setVisibleSkip(null);
                }
              }
            }}
            onDurationChange={(event: any) => {
              const value = Number(
                event?.detail ??
                  event?.currentTarget?.duration ??
                  document.querySelector("video")?.duration ??
                  0,
              );
              progressRef.current.duration = Number.isFinite(value)
                ? value
                : 0;
              if (Number.isFinite(value) && value > 0) setDuration(value);
            }}
            onEnded={() => {
              setPlaying(false);
              persist();
              if (prefs.autoNext && nextEpisode) {
                router.push(
                  `/watch/${anilistId}?ep=${nextEpisode}&audio=${audio}`,
                );
              }
            }}
            onPlay={() => {
              setPlaying(true);
              setWaiting(false);
            }}
            onPause={() => {
              setPlaying(false);
              persist();
            }}
            onWaiting={() => setWaiting(true)}
            onStalled={() => setWaiting(true)}
            onPlaying={() => {
              setWaiting(false);
              setPlaying(true);
            }}
            onProviderChange={providerChange}
          >
            <MediaProvider>{subtitleTracks}</MediaProvider>
            <DefaultVideoLayout
              icons={defaultLayoutIcons}
              thumbnails={data?.thumbnails?.url}
            />
            {/* Inside the player tree: visible in fullscreen too. */}
            {visibleSkip && (
              <button
                id={styles.skip_btn}
                type="button"
                data-testid="skip-button"
                aria-label={skipLabel(visibleSkip.key)}
                onClick={() => {
                  skippedRanges.current.add(visibleSkip.key);
                  seekTo(visibleSkip.range.end);
                  visibleSkipKeyRef.current = null;
                  setVisibleSkip(null);
                }}
              >
                <span className={styles.btn_text}>
                  {skipLabel(visibleSkip.key)}
                </span>
              </button>
            )}
          </MediaPlayer>
        )}
        {error && (
          <div
            role="alert"
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              color: "white",
              background: "#000",
            }}
          >
            <div>
              <p>{error}</p>
              <button
                type="button"
                onClick={() => {
                  setPlaybackError("");
                  watch.retry();
                }}
              >
                Retry
              </button>
            </div>
          </div>
        )}
        {waiting && source && (
          <span className="sr-only" role="status">
            Buffering
          </span>
        )}
        {!playing && !waiting && data && source && (
          <span className="sr-only">Paused</span>
        )}
      </div>
      {dbg && (
        <>
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(dbg.join("\n"))}
          >
            Copy log
          </button>
          <pre
            style={{
              fontSize: 10,
              whiteSpace: "pre-wrap",
              background: "#111",
              color: "#9f9",
              padding: 6,
              maxHeight: 220,
              overflow: "auto",
              userSelect: "text",
            }}
          >
            {dbg.join("\n")}
          </pre>
        </>
      )}
    </div>
  );
}
