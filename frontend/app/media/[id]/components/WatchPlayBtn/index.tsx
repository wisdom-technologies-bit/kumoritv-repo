"use client";
import React, { useEffect, useLayoutEffect, useState } from "react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import styles from "./component.module.css";
import pageStyles from "../../components/PageHeading/GridInfo/component.module.css";
import PlaySvg from "@/public/assets/play2.svg";
import DubbedCheckboxButton from "../AnimeEpisodesContainer/components/ActiveDubbButton";
import {
  CONTINUE_WATCHING_MIN_SECONDS,
  getProgress,
  isProgressCompleted,
  subscribe,
} from "@/app/lib/user-data/progress";
import { readPrefs, usePrefs } from "@/app/lib/user-data/prefs";
import { displayTitle } from "@/app/lib/titles";

type PlayTarget = {
  /** Episode the button opens. */
  episode: number;
  /** Seconds to resume from, 0 when the episode starts from the beginning. */
  time: number;
  /** Fraction of the episode already watched, 0 when there is nothing to show. */
  progress: number;
  /** Drives the "EPISODE N" / "CONTINUE" label. */
  hasLabel: boolean;
  /** The resume record was stored in dub, so the destination keeps that audio. */
  dub: boolean;
};

const firstEpisode: PlayTarget = {
  episode: 1,
  time: 0,
  progress: 0,
  hasLabel: false,
  dub: false,
};

function isResumable(time: number, duration: number) {
  return time >= CONTINUE_WATCHING_MIN_SECONDS && (!duration || time < duration - 10);
}

/**
 * Decides where the play button goes, from the local + Supabase progress layer.
 * a) an unfinished episode with some time on it resumes at that time;
 * b) otherwise a watched episode opens the next one (AniList progress included);
 * c) otherwise episode 1.
 */
export function decidePlayTarget({
  mediaId,
  mediaFormat,
  anilistLastEpisodeWatched,
  mediaEpisodes,
  nextAiringEpisode,
}: {
  mediaId: number;
  mediaFormat?: string;
  anilistLastEpisodeWatched?: number;
  mediaEpisodes?: number | null;
  nextAiringEpisode?: { episode: number } | null;
}): PlayTarget {
  const isMovie = mediaFormat === "MOVIE";
  const record = getProgress(mediaId);

  // a) resume the episode the viewer stopped in the middle of
  if (!isMovie && record && isResumable(record.time, record.duration)) {
    const episode = record.episode || 1;

    return {
      episode,
      time: Math.floor(record.time),
      progress: record.duration > 0 ? Math.min(record.time / record.duration, 1) : 0,
      hasLabel: true,
      dub: record.audio === "dub",
    };
  }

  if (isMovie) {
    // movies have a single "episode": a part-watched movie still opens ep 1, but
    // it does resume where the viewer stopped.
    const resumeMovie = !!record && isResumable(record.time, record.duration);

    return resumeMovie
      ? {
          episode: 1,
          time: Math.floor(record!.time),
          progress: record!.duration > 0 ? Math.min(record!.time / record!.duration, 1) : 0,
          hasLabel: true,
          dub: record!.audio === "dub",
        }
      : { ...firstEpisode };
  }

  // b) next episode after the highest one watched
  const watched = [...(record?.watched || [])];
  if (record && isProgressCompleted(record.time, record.duration)) watched.push(record.episode || 1);

  const highestLocal = watched.length ? Math.max(...watched) : 0;
  const highest = Math.max(highestLocal, anilistLastEpisodeWatched || 0);

  if (highest > 0) {
    // For a currently-airing show only the aired episodes exist: cap at the
    // aired number (AniList nextAiringEpisode - 1), never at the announced total.
    const aired = nextAiringEpisode?.episode ? nextAiringEpisode.episode - 1 : 0;
    const lastAvailable = aired || mediaEpisodes || 0;
    const nextEpisode = highest + 1;
    // When the highest watched episode is already the last one there is nothing
    // after it, so the button stays on that episode.
    const episode = lastAvailable > 0 ? Math.min(nextEpisode, lastAvailable) : nextEpisode;

    return {
      episode,
      time: 0,
      progress: 0,
      hasLabel: true,
      dub: record?.audio === "dub",
    };
  }

  // c) nothing watched yet
  return { ...firstEpisode };
}

export default function PlayBtn({
  mediaId,
  mediaTitle,
  mediaFormat,
  anilistLastEpisodeWatched,
  mediaEpisodes,
  nextAiringEpisode,
}: {
  mediaId: number;
  mediaTitle: string;
  mediaFormat?: string;
  anilistLastEpisodeWatched?: number;
  mediaEpisodes?: number | null;
  nextAiringEpisode?: { episode: number } | null;
}) {
  const router = useRouter();

  const { prefs, setPref } = usePrefs();
  const [isDubbedActive, setIsDubbedActive] = useState<boolean>(false);

  // The server renders (and the first client paint shows) the no-progress state,
  // then the real target is applied after mount: guests read localStorage,
  // signed-in users read the hydrated server progress.
  const [target, setTarget] = useState<PlayTarget>(firstEpisode);

  const title = displayTitle(mediaTitle);

  useEffect(() => {
    const apply = () =>
      setTarget(
        decidePlayTarget({
          mediaId,
          mediaFormat,
          anilistLastEpisodeWatched,
          mediaEpisodes,
          nextAiringEpisode,
        }),
      );

    apply();

    return subscribe(apply);
  }, [mediaId, mediaFormat, anilistLastEpisodeWatched, mediaEpisodes, nextAiringEpisode]);

  // The preference decides the audio the button opens. `usePrefs` resolves the
  // signed-in profile after hydration, so a guest (or a fast click right after
  // load) reads the saved value synchronously first, before paint.
  useLayoutEffect(() => {
    setIsDubbedActive(readPrefs().dubEpisodes);
  }, []);

  useEffect(() => {
    setIsDubbedActive(prefs.dubEpisodes);
  }, [prefs.dubEpisodes]);

  const isMovie = mediaFormat === "MOVIE";
  // A resume record's own audio wins; otherwise the saved preference does.
  const dubbed = target.dub || isDubbedActive;
  // The audio is ALWAYS explicit, so the destination never depends on what the
  // watch page would have guessed.
  const destination = `/watch/${mediaId}?ep=${target.episode}${
    target.time > 0 ? `&t=${target.time}` : ""
  }&audio=${dubbed ? "dub" : "sub"}`;

  // Movies say CONTINUE, series say EPISODE N, and nothing is shown at all until
  // there is something to continue from.
  const episodeLabel = target.hasLabel ? (isMovie ? "CONTINUE" : `EPISODE ${target.episode}`) : null;

  const ariaLabel = target.hasLabel
    ? `Continue ${isMovie ? title : `Episode ${target.episode} - ${title}`}`
    : "Watch Episode 1";

  const buttonTitle = target.hasLabel
    ? `Watch ${isMovie ? title : `Episode ${target.episode} - ${title}`}`
    : `Watch ${title}`;

  return (
    <React.Fragment>
      <li className={`${pageStyles.info_item} ${pageStyles.action_btn}`}>
        <motion.button
          id={styles.container}
          role="link"
          onClick={() => router.push(destination)}
          aria-label={ariaLabel}
          title={buttonTitle}
          data-episode={target.episode}
        >
          <ProgressBar progress={target.progress} />

          <EpisodeNumber label={episodeLabel} />

          <PlaySvg fill="#fff" width={16} height={16} />
        </motion.button>
      </li>

      {isMovie && (
        <li className={`${pageStyles.info_item}`}>
          <h2>MOVIE</h2>

          <div id={styles.movie_options_settings_container}>
            <DubbedCheckboxButton
              isDubActive={isDubbedActive}
              clickAction={() => {
                setIsDubbedActive(!isDubbedActive);
                void setPref("dubEpisodes", !isDubbedActive);
              }}
              styleRow
            />
          </div>
        </li>
      )}
    </React.Fragment>
  );
}

function ProgressBar({ progress }: { progress: number }) {
  const isActive = progress > 0;

  return (
    isActive && (
      <motion.div className={styles.progress_bar}>
        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: progress || 0.07 }}
          transition={{ duration: 1 }}
        />
      </motion.div>
    )
  );
}

function EpisodeNumber({ label }: { label: string | null }) {
  return label ? <span id={styles.continue_span}>{label}</span> : null;
}
