"use client";
// Watch page episode list: same component as the media page, plus the current
// episode marker (and auto-scroll to it).
import { useEffect, useState } from "react";
import styles from "./component.module.css";
import EpisodeList from "@/app/components/EpisodeList";
import { convertFromUnix } from "@/app/lib/formatDateUnix";
import {
  getProgress,
  subscribe,
  markWatched,
} from "@/app/lib/user-data/progress";
import type { EpisodeItem } from "@/app/lib/episodes/items";

type Props = {
  mediaId: number;
  activeEpisodeNumber: number;
  audio: "sub" | "dub";
  nextAiringEpisodeInfo?: { episode: number; airingAt?: number };
  format?: string | null;
};

export default function EpisodesListContainer({
  mediaId,
  activeEpisodeNumber,
  audio,
  nextAiringEpisodeInfo,
  format,
}: Props) {
  const [state, setState] = useState<any>(null);
  const [retry, setRetry] = useState(0);
  const [watched, setWatched] = useState<number[]>([]);

  useEffect(() => {
    const sync = () => {
      const record = getProgress(mediaId);
      const list = [...(record?.watched || [])];
      // An episode past the playhead counts as watched in the list too.
      if (record?.episode) list.push(record.episode);
      setWatched([...new Set(list)].sort((a, b) => a - b));
    };
    sync();
    return subscribe(sync);
  }, [mediaId]);

  useEffect(() => {
    let live = true;
    const load = () =>
      fetch(`/api/anime/${mediaId}/episodes`)
        .then((r) => r.json())
        .then((payload) => {
          if (live) setState(payload);
        })
        .catch(() => {});
    load();
    const timer = setInterval(() => {
      if (state?.status === "syncing") load();
    }, 3000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [mediaId, retry, state?.status]);

  const episodes: EpisodeItem[] = state?.episodes || [];
  const loading = !state || state.status === "syncing";

  // The played episode is marked watched once it is in the list.
  useEffect(() => {
    if (!episodes.length) return;
    if (episodes.some((item) => item.number === activeEpisodeNumber))
      markWatched(mediaId, activeEpisodeNumber, true);
  }, [episodes.length, activeEpisodeNumber, mediaId]);

  // The next-airing line rides on the panel header as a small chip (same text).
  const nextAiringChip = nextAiringEpisodeInfo ? (
    <span className={styles.next_episode}>
      Next episode {nextAiringEpisodeInfo.episode}
      {nextAiringEpisodeInfo.airingAt
        ? ` · ${convertFromUnix(nextAiringEpisodeInfo.airingAt)}`
        : ""}
    </span>
  ) : undefined;

  return (
    <div id={styles.episodes_list_container}>
      {state?.status === "unavailable" ? (
        <div className={styles.filler_alert_text}>
          No episodes available yet{" "}
          <button type="button" onClick={() => setRetry((x) => x + 1)}>
            Retry
          </button>
        </div>
      ) : loading && !episodes.length ? (
        <div className={styles.loading} aria-hidden />
      ) : (
        <EpisodeList
          episodes={episodes}
          anilistId={mediaId}
          audio={audio}
          activeEpisode={activeEpisodeNumber}
          watched={watched}
          format={format}
          title="Episodes"
          variant="sidebar"
          headerSlot={nextAiringChip}
        />
      )}
    </div>
  );
}
