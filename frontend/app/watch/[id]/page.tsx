import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import styles from "./page.module.css";
import * as MediaCardExpanded from "@/app/components/MediaCards/MediaInfoExpandedWithCover";
import { getMediaInfo } from "@/app/lib/anilist/medias.server";
import VideoPlayer from "./components/VideoPlayer";
import WatchControls from "./components/WatchControls";
import EpisodesListContainer from "./components/EpisodesListContainer";
import { WatchState } from "./components/WatchState";
function clean(s: string | null | undefined) {
  return (s || "").replace(/<[^>]*>/g, "").trim();
}
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { ep?: string };
}) {
  const media = await getMediaInfo({ id: Number(params.id) });
  if (!media) return { title: "Not Found | KumoriTV" };
  const ep = Number(searchParams.ep || 1);
  const title = media.title.userPreferred || `Anime ${params.id}`;
  const site = process.env.NEXT_PUBLIC_SITE_URL || "https://kumoritv.vercel.app";
  return {
    title: `Watch ${title} Episode ${ep} - KumoriTV`,
    description: `Watch ${title} episode ${ep} on KumoriTV.`,
    alternates: { canonical: `${site}/watch/${params.id}?ep=${ep}` },
  };
}
export default async function WatchPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: {
    ep?: string;
    episode?: string;
    audio?: string;
    dub?: string;
    t?: string;
  };
}) {
  const media = await getMediaInfo({ id: Number(params.id) });
  if (!media) notFound();
  const ep =
    media.format === "MOVIE"
      ? 1
      : Number(searchParams.ep || searchParams.episode || 1);
  const audio =
    searchParams.audio || (searchParams.dub === "true" ? "dub" : "sub");
  const lang = cookies().get("subtitle_language")?.value || "English";
  let episodeTitle = `Episode ${ep}`;
  if (media.format !== "MOVIE") {
    try {
      const origin =
        process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
      const response = await fetch(
        `${origin}/api/anime/${params.id}/episodes`,
        { signal: AbortSignal.timeout(1500), cache: "no-store" },
      );
      const payload = await response.json();
      episodeTitle =
        payload.episodes?.find((item: any) => item.number === ep)?.title ||
        episodeTitle;
    } catch {}
  }
  return (
    <WatchState
      anilistId={Number(params.id)}
      episode={ep}
      initialAudio={audio as "sub" | "dub"}
      initialSubtitleLanguage={lang}
    >
      <main id={styles.container}>
        <section className={styles.background}>
          <div id={styles.video_container}>
            <VideoPlayer
              anilistId={Number(params.id)}
              episode={ep}
              audio={audio as "sub" | "dub"}
              subtitleLanguage={lang}
              initialTime={Number(searchParams.t || 0)}
              title={media.title.userPreferred}
            />
          </div>
        </section>
        <WatchControls
          anilistId={Number(params.id)}
          episode={ep}
          audio={audio as "sub" | "dub"}
        />
        <section id={styles.media_info_container}>
          <div id={styles.heading_info_container}>
            <h1>
              EP {ep} -{" "}
              {media.format === "MOVIE"
                ? media.title.english || media.title.userPreferred
                : episodeTitle}
            </h1>
            <MediaCardExpanded.Container mediaInfo={media as any}>
              <MediaCardExpanded.Description description={media.description} />
            </MediaCardExpanded.Container>
          </div>
          <EpisodesListContainer
            mediaId={Number(params.id)}
            activeEpisodeNumber={ep}
            audio={audio as "sub" | "dub"}
            nextAiringEpisodeInfo={media.nextAiringEpisode || undefined}
          />
        </section>
      </main>
    </WatchState>
  );
}
