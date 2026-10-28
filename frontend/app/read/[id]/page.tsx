import Link from "next/link";
import React from "react";
import styles from "./page.module.css";
import * as MediaCardExpanded from "@/app/components/MediaCards/MediaInfoExpandedWithCover";
import { MangadexMangaChapters, MangadexMangaPages } from "@/app/ts/interfaces/mangadex";
import { MediaData } from "../../ts/interfaces/anilistMediaData";
import ChaptersPages from "./components/ChaptersPages/index.js";
import ChaptersListContainer from "./components/ChaptersListContainer";
import { getMediaInfo } from "@/app/lib/anilist/medias.server";
import { getChaptersByAniListId, getChapterPages } from "@/app/lib/manga/mangadex";

export const revalidate = 1800; // revalidate cached data every 30 minutes

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ReadSearchParams = {
  chapter?: string;
  source?: "mangadex";
  q?: string;
  page?: string;
};

function canonicalChapterHref(id: string, chapter: string, chapterId: string) {
  return `/read/${id}?chapter=${encodeURIComponent(chapter)}&source=mangadex&q=${encodeURIComponent(chapterId)}`;
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: { id: number };
  searchParams: ReadSearchParams;
}) {
  const mediaInfo = await getMediaInfo({ id: params.id });
  const chapter = searchParams?.chapter ?? "";
  const title = mediaInfo?.title?.userPreferred || mediaInfo?.title?.romaji;

  if (!title) {
    return { title: "Chapter not found", description: "This chapter could not be loaded." };
  }

  return {
    // The template adds the brand text.
    title: `Read ${title} Chapter ${chapter}`,
    description: `Read ${title} chapter ${chapter} online in English.`,
    alternates: {
      canonical: canonicalChapterHref(
        String(params.id),
        chapter,
        searchParams?.q ?? "",
      ),
    },
  };
}

function ChapterUnavailable({
  mediaId,
  message,
}: {
  mediaId: string | number;
  message: string;
}) {
  return (
    <main id={styles.container}>
      <div id={styles.heading_container}>
        <h1>Chapter unavailable</h1>
        <small>{message}</small>
      </div>

      <p>
        <Link href={`/media/${mediaId}`}>Back to the media page</Link>
      </p>
    </main>
  );
}

async function ReadChapter({
  params,
  searchParams,
}: {
  params: { id: number }; // ANILIST MANGA ID
  searchParams: ReadSearchParams;
}) {
  const mediaInfo = await getMediaInfo({ id: params.id });

  if (!mediaInfo) {
    return <ChapterUnavailable mediaId={params.id} message="This title could not be found." />;
  }

  const chapterList = await getChaptersByAniListId(Number(params.id));

  if (chapterList.status !== "ready" || chapterList.chapters.length === 0) {
    return (
      <ChapterUnavailable
        mediaId={params.id}
        message={
          chapterList.status === "unavailable"
            ? "No chapters available for this title (it may be licensed or not on MangaDex)."
            : "The chapters could not be loaded right now. Try again in a moment."
        }
      />
    );
  }

  const allAvailableChaptersList: MangadexMangaChapters[] = chapterList.chapters.filter(
    (item) => item.pages != 0,
  );

  const currChapterInfo =
    allAvailableChaptersList.find((item) => item.id == searchParams?.q) ||
    allAvailableChaptersList.find(
      (item) => String(item.chapterNumber) === String(searchParams?.chapter),
    );

  if (!currChapterInfo) {
    return (
      <ChapterUnavailable
        mediaId={params.id}
        message="This chapter is not on MangaDex for this title."
      />
    );
  }

  let pages: MangadexMangaPages[] = [];
  if (searchParams?.q && UUID.test(searchParams.q)) {
    try {
      pages = await getChapterPages(searchParams.q);
    } catch {
      pages = [];
    }
  }

  if (pages.length === 0) {
    return (
      <ChapterUnavailable
        mediaId={params.id}
        message="These pages could not be loaded. Open the media page and try another chapter."
      />
    );
  }

  return (
    <main id={styles.container}>
      <div id={styles.heading_container}>
        <h1>
          <span>{mediaInfo.title.userPreferred}: </span>
          {currChapterInfo.title == currChapterInfo.chapterNumber
            ? `Chapter ${currChapterInfo.chapterNumber}`
            : currChapterInfo.title}
        </h1>

        <small>{currChapterInfo.pages} Pages</small>
      </div>

      <ChaptersPages
        chapters={pages}
        initialPage={Number(searchParams?.page) || undefined}
        mediaId={params.id}
        chapterNumber={currChapterInfo.chapterNumber}
        chapterId={currChapterInfo.id}
      />

      <div id={styles.all_chapters_container}>
        <MediaCardExpanded.Container mediaInfo={mediaInfo as MediaData}>
          <MediaCardExpanded.Description description={mediaInfo.description} />
        </MediaCardExpanded.Container>

        <ChaptersListContainer
          mediaId={params.id}
          currChapterId={currChapterInfo.id}
          chaptersList={allAvailableChaptersList}
        />
      </div>
    </main>
  );
}

export default ReadChapter;
