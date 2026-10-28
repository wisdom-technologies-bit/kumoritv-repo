"use client";
import React, { useEffect, useState } from "react";
import styles from "./component.module.css";
import Link from "next/link";
import { MangadexMangaChapters } from "@/app/ts/interfaces/mangadex";
import BookSvg from "@/public/assets/book.svg";
import PaginationButtons from "@/app/media/[id]/components/PaginationButtons";
import { getMangaChaptersWithStatus } from "@/app/api/consumet/consumetManga";
import { AnimatePresence, motion, Variants } from "framer-motion";
import simulateRange from "@/app/lib/simulateRange";
import MarkChapterAsReadButton from "@/app/components/Buttons/MarkChapterAsRead";
import { MediaDataFullInfo } from "@/app/ts/interfaces/anilistMediaData";
import { listRead, subscribeChapters } from "@/app/lib/user-data/chapters";
import { useSearchParams } from "next/navigation";
import ErrorPanel from "../ErrorPanel";
import { displayTitle } from "@/app/lib/titles";

const framerMotionLoadingChapters: Variants = {
  initial: {
    opacity: 0.5,
  },
  animate: {
    opacity: 1,
    transition: {
      repeat: Infinity,
      duration: 1,
      repeatType: "reverse",
    },
  },
  exit: {
    opacity: 0,
  },
};

const framerMotionShowUpChapters = {
  initial: {
    opacity: 0.5,
  },
  animate: {
    opacity: 1,
  },
  exit: {
    opacity: 0,
    scale: 0,
  },
};

function MangaChaptersContainer({
  mediaInfo,
  chaptersReadOnAnilist,
}: {
  mediaInfo: MediaDataFullInfo;
  chaptersReadOnAnilist?: number;
}) {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [chaptersList, setChaptersList] = useState<MangadexMangaChapters[]>([]);
  const [sourceStatus, setSourceStatus] = useState<"ready" | "unavailable" | "error">(
    "ready"
  );
  const [readChapters, setReadChapters] = useState<Set<number>>(new Set());

  const [currMangasList, setCurrMangasList] = useState<
    MangadexMangaChapters[] | null
  >(null);

  const [totalNumberPages, setTotalNumberPages] = useState<number>(0);
  const [currActivePage, setCurrActivePage] = useState<number>(0);

  const [itemOffset, setItemOffset] = useState<number>(0);

  const rangeChaptersPerPage = 10;

  const searchParams = useSearchParams();

  const currSearchParams = new URLSearchParams(
    Array.from(searchParams.entries())
  );

  // READ MARKS (local for guests, Supabase for signed-in users)
  useEffect(() => {
    let active = true;

    function loadReadMarks() {
      listRead(mediaInfo.id)
        .then((records) => {
          if (active) {
            setReadChapters(new Set(records.map((record) => Number(record.chapterNumber))));
          }
        })
        .catch(() => {
          /* read marks are optional */
        });
    }

    loadReadMarks();

    const unsubscribe = subscribeChapters(loadReadMarks);

    return () => {
      active = false;
      unsubscribe();
    };
  }, [mediaInfo.id]);

  useEffect(() => {
    if (chaptersList.length == 0) fetchMangaChapters();

    const endOffset = itemOffset + rangeChaptersPerPage;
    setCurrMangasList(chaptersList.slice(itemOffset, endOffset));
  }, [itemOffset, rangeChaptersPerPage]);

  // handles which page last chapter read is on
  useEffect(() => {
    if (!chaptersReadOnAnilist) return;

    for (let pageIndex = 0; pageIndex < totalNumberPages; pageIndex++) {
      const chaptersOnPage =
        (pageIndex * rangeChaptersPerPage) % chaptersList.length;

      if (
        Number(chaptersList[pageIndex * chaptersOnPage]?.chapterNumber) >=
        chaptersReadOnAnilist
      ) {
        handleButtonPageNavigation({ selected: pageIndex - 1 });

        setCurrActivePage(pageIndex - 1);

        return;
      }

      if (pageIndex + 1 == totalNumberPages) {
        handleButtonPageNavigation({ selected: pageIndex });

        setCurrActivePage(pageIndex);

        return;
      }
    }
  }, [totalNumberPages]);

  function handleButtonPageNavigation(event: { selected: number }) {
    setIsLoading(true); // Needed to refresh chapters component "Mark Chapters Read"

    const newOffset =
      (event.selected * rangeChaptersPerPage) % chaptersList.length;

    setItemOffset(newOffset);

    setTimeout(() => setIsLoading(false), 400); // Needed to refresh chapters component "Mark Chapters Read"
  }

  async function fetchMangaChapters() {
    setIsLoading(true);
    setSourceStatus("ready");

    // The AniList id is all the server needs: matching happens there.
    const result = await getMangaChaptersWithStatus(mediaInfo.id);

    if (!result || result.status !== "ready") {
      setSourceStatus(result?.status == "unavailable" ? "unavailable" : "error");
      setIsLoading(false);
      setChaptersList([]);
      setCurrMangasList(null);
      setTotalNumberPages(0);
      return;
    }

    const readableChapters = result.chapters.filter((item) => item.pages != 0);

    setChaptersList(readableChapters);

    const endOffset = itemOffset + rangeChaptersPerPage;

    setCurrMangasList(readableChapters.slice(itemOffset, endOffset));

    setTotalNumberPages(Math.ceil(readableChapters.length / rangeChaptersPerPage));

    setIsLoading(false);
  }

  return (
    <div>
      <AnimatePresence>
        <motion.ol id={styles.container} data-loading={isLoading}>
          {/* LOADING */}
          {isLoading && (
            <motion.li
              id={styles.loading_chapters_container}
              variants={framerMotionLoadingChapters}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              {simulateRange(10).map((item, key) => (
                <motion.div key={key} variants={framerMotionLoadingChapters} />
              ))}
            </motion.li>
          )}

          {!isLoading &&
            currMangasList?.map((chapter, key) => (
              <motion.li
                key={key}
                title={`Chapter ${chapter.chapterNumber} - ${displayTitle(mediaInfo.title)}`}
                data-disabled={chapter.pages == 0}
                variants={framerMotionShowUpChapters}
                className={styles.chapter_container}
              >
                <div className={styles.icon_container}>
                  <BookSvg alt="Book Opened Icon" width={16} heighy={16} />
                </div>

                <Link
                  href={`/read/${mediaInfo.id}?source=mangadex&chapter=${chapter.chapterNumber}&q=${chapter.id}`}
                >
                  <div className={styles.info_container}>
                    <h3>
                      {chapter.title != chapter.chapterNumber
                        ? `Chapter ${chapter.chapterNumber}: ${chapter.title}`
                        : `Chapter ${chapter.chapterNumber}` || "Not Available"}
                    </h3>

                    <p>
                      {chapter.pages == 0
                        ? "No Pages Found!"
                        : `${chapter.pages} Pages`}
                    </p>
                  </div>
                </Link>

                <MarkChapterAsReadButton
                  chapterNumber={Number(chapter.chapterNumber)}
                  chapterTitle={chapter.title}
                  wasChapterReadOnAnilist={
                    readChapters.has(Number(chapter.chapterNumber))
                      ? true
                      : chaptersReadOnAnilist
                        ? Number(chapter.chapterNumber) <= chaptersReadOnAnilist
                        : undefined
                  }
                  mediaId={mediaInfo.id}
                  showAdditionalText
                />
              </motion.li>
            ))}

          {/* SOURCE UNAVAILABLE: NOT ON MANGADEX OR LICENSED-ONLY */}
          {!isLoading &&
            sourceStatus == "unavailable" && (
              <ErrorPanel
                errorText={
                  <>
                    No chapters available for this title (it may be licensed or
                    not on MangaDex).
                  </>
                }
              />
            )}

          {/* SOURCE ERROR: RETRY */}
          {!isLoading && sourceStatus == "error" && (
            <ErrorPanel
              errorText={
                <>
                  Chapters could not be loaded right now.{" "}
                  <button
                    onClick={() => fetchMangaChapters()}
                    className={styles.retry_btn}
                    type="button"
                  >
                    Try again
                  </button>
                </>
              }
            />
          )}

          {/* SHOWS WHEN THERES NO RESULTS  */}
          {!isLoading &&
            sourceStatus == "ready" &&
            (chaptersList.length == 0 || currMangasList == null) && (
              <ErrorPanel errorText={<>No chapters available.</>} />
            )}
        </motion.ol>
      </AnimatePresence>

      {totalNumberPages >= 1 && (
        <nav id={styles.pagination_buttons_container}>
          <PaginationButtons
            onPageChange={handleButtonPageNavigation}
            pageCount={totalNumberPages}
            redirectToPage={
              Number(currSearchParams.get("page")) || currActivePage
            }
          />
        </nav>
      )}
    </div>
  );
}

export default MangaChaptersContainer;
