"use client";

// Prompt 35: the clip page's player.
//
// It is the SAME player component the watch page uses, given a range: start at
// `start`, pause at `end`, then show the end card. Playback never leaves the
// normal stream, so nothing is cut, hosted or re-served. It mounts one view ping
// per page load; the route counts it once per session.

import { useEffect } from "react";
import VideoPlayer from "@/app/watch/[id]/components/VideoPlayer";
import { WatchState } from "@/app/watch/[id]/components/WatchState";
import WatchLayout from "@/app/watch/[id]/components/WatchLayout";
import ClipBridge from "@/app/watch/[id]/components/ClipBridge";
import styles from "../../page.module.css";

export default function ClipPlayer({
  code,
  anilistId,
  episode,
  start,
  end,
  audio,
  subtitleLanguage,
  title,
  episodeImage,
  cover,
  fullEpisodeHref,
  animeTitle,
}: {
  code: string;
  anilistId: number;
  episode: number;
  start: number;
  end: number;
  audio: "sub" | "dub";
  subtitleLanguage: string;
  title: string;
  episodeImage?: string;
  cover?: string;
  fullEpisodeHref: string;
  animeTitle: string;
}) {
  useEffect(() => {
    // No personal data: the cookie only says this browser already counted it.
    void fetch(`/api/clips/${encodeURIComponent(code)}/view`, { method: "POST" }).catch(
      () => undefined,
    );
  }, [code]);

  return (
    <WatchState
      anilistId={anilistId}
      episode={episode}
      initialAudio={audio}
      initialSubtitleLanguage={subtitleLanguage}
    >
      <ClipBridge anilistId={anilistId} episode={episode} audio={audio} animeTitle={animeTitle}>
        <WatchLayout>
          <div id={styles.video_container}>
            <VideoPlayer
              anilistId={anilistId}
              episode={episode}
              audio={audio}
              subtitleLanguage={subtitleLanguage}
              initialTime={start}
              title={title}
              episodeImage={episodeImage}
              cover={cover}
              clip={{ start, end, mode: "clip", fullEpisodeHref }}
              trackProgress={false}
            />
          </div>
        </WatchLayout>
      </ClipBridge>
    </WatchState>
  );
}
