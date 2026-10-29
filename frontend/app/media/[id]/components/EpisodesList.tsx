"use client";
// Media page episode list: the same ani.pm-style component the watch page uses.
import EpisodeList from "@/app/components/EpisodeList";
import type { EpisodeItem } from "@/app/lib/episodes/items";

export default function EpisodesList({
  anilistId,
  format,
  episodes,
  audio = "sub",
}: {
  anilistId: number;
  format: string | null;
  cover?: string;
  episodes: EpisodeItem[];
  audio?: "sub" | "dub";
}) {
  return (
    <EpisodeList
      episodes={episodes}
      anilistId={anilistId}
      audio={audio}
      format={format}
      title="Episodes"
    />
  );
}
