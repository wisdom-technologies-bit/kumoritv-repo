"use client";
import { useUser } from "@/app/lib/supabase/AuthProvider";
import React, { useEffect, useRef, useState } from "react";
import styles from "./component.module.css";
import { MediaData } from "@/app/ts/interfaces/anilistMediaData";
import { AnimatePresence, motion } from "framer-motion";
import {
  getListStatus,
  removeFromList,
  setListStatus,
} from "@/app/lib/user-data/lists";
import { markWatched } from "@/app/lib/user-data/progress";
import { useAppDispatch, useAppSelector } from "@/app/lib/redux/hooks";
import anilistUsers from "@/app/api/anilist/anilistUsers";
import { ImdbEpisode } from "@/app/ts/interfaces/imdb";
import { userMediaStatusEntries } from "@/app/lib/dataConstants/anilist";
import { toggleShowLoginModalValue } from "@/app/lib/redux/features/loginModal";
import { displayTitle } from "@/app/lib/titles";

export function Button({
  mediaInfo,
  statusOnAnilist,
  listEntryId,
  imdbEpisodesList,
  amountWatchedOrRead,
  children,
  variant = "pill",
}: {
  mediaInfo: MediaData;
  imdbEpisodesList?: ImdbEpisode[];
  statusOnAnilist?: MediaData["mediaListEntry"]["status"];
  listEntryId?: number;
  amountWatchedOrRead?: number;
  children?: React.ReactNode[];
  /** "round" = the shared icon circle (media hero / watch card). */
  variant?: "pill" | "round";
}) {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const [mediaStatus, setMediaStatus] = useState<
    MediaData["mediaListEntry"]["status"] | null
  >(statusOnAnilist || null);

  const anilistUser = useAppSelector((state) => state.UserInfo.value);
  const dispatch = useAppDispatch();

  const { user } = useUser();

  useEffect(() => {
    if (!statusOnAnilist) {
      void isMediaOnUserLists();
    }
  }, [statusOnAnilist, user, anilistUser]);

  // The open menu closes on Escape and on a tap outside it (button included, so
  // the button's own toggle does not close and immediately reopen it).
  useEffect(() => {
    if (!isMenuOpen) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsMenuOpen(false);
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;

      if (!target) return;
      if (buttonRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;

      setIsMenuOpen(false);
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [isMenuOpen]);

  // IF MEDIA ID MATCHS ANY RESULT ON DB, IT SETS THIS COMPONENT BUTTON AS ACTIVE
  async function isMediaOnUserLists() {
    const savedStatus = await getListStatus(mediaInfo.id);

    if (!savedStatus) return;

    const matchingEntry = userMediaStatusEntries.find(
      (btn) => btn.value.toLowerCase() == savedStatus.status.toLowerCase()
    );

    if (matchingEntry)
      setMediaStatus(matchingEntry.value as MediaData["mediaListEntry"]["status"]);
  }

  async function setEpisodesWatched(action: "add" | "remove") {
    if (!imdbEpisodesList) return;

    imdbEpisodesList.map((episode, index) =>
      markWatched(mediaInfo.id, index + 1, action == "add")
    );
  }

  async function handleAddMediaOnList({
    status,
  }: {
    status: MediaData["mediaListEntry"]["status"];
  }) {
    // Opens Login Modal
    if (!user && !anilistUser) return dispatch(toggleShowLoginModalValue());

    setIsLoading(true);

    const mediaData = {
      id: mediaInfo.id,
      title: {
        romaji: mediaInfo.title.romaji,
        english: typeof mediaInfo.title === "string" ? undefined : mediaInfo.title.english,
        native: typeof mediaInfo.title === "string" ? undefined : mediaInfo.title.native,
        userPreferred: displayTitle(mediaInfo.title),
      },
      format: mediaInfo.format,
      description: mediaInfo.description,
      coverImage: {
        extraLarge: mediaInfo.coverImage.extraLarge,
        large: mediaInfo.coverImage.large,
      },
    };

    // Remove from curr list
    if (mediaStatus) {
      const isSameStatus =
        mediaStatus.toLowerCase() == status.toLowerCase();

      await removeFromList(mediaInfo.id);

      // Remove from anilist list
      if (anilistUser && isSameStatus) {
        try {
          await anilistUsers.removeMediaFromSelectedList({
            listItemEntryId: listEntryId!,
          });
        } catch {
          // AniList sync is best effort
        }

        setIsLoading(false);

        setMediaStatus(null);

        return;
      }
    }

    if (status == "COMPLETED") await setEpisodesWatched("add");

    await setListStatus({
      snapshot: mediaData,
      status,
      progress:
        status == "COMPLETED"
          ? mediaInfo.episodes
          : amountWatchedOrRead || 0,
      totalEpisodes: mediaInfo.episodes,
    });

    if (anilistUser) {
      try {
        await anilistUsers.addMediaToSelectedList({
          status: status,
          mediaId: mediaInfo.id,
          episodeOrChapterNumber:
            status == "COMPLETED" ? mediaInfo.episodes : amountWatchedOrRead || 0,
          numberWatchedOrReadUntilNow: amountWatchedOrRead || 0,
        });
      } catch {
        // AniList sync is best effort
      }
    }

    setIsLoading(false);

    setMediaStatus(status);
  }

  return (
    <React.Fragment>
      <motion.button
        ref={buttonRef}
        whileTap={{ scale: 0.85 }}
        id={variant === "round" ? undefined : styles.container}
        className={
          variant === "round" ? "kumori-round" : children ? styles.custom_text : ""
        }
        onClick={() => setIsMenuOpen(!isMenuOpen)}
        aria-label={isMenuOpen ? "Close List" : "Open List"}
        title={isMenuOpen ? "Close List" : "Open List"}
        data-active={isMenuOpen}
        data-has-value={mediaStatus != null}
      >
        {isMenuOpen ? children![1] : children![0]}
      </motion.button>

      <AnimatePresence>
        {isMenuOpen && (
          <motion.div
            ref={menuRef}
            id={styles.user_media_status_list}
            aria-expanded={isMenuOpen}
            data-is-loading={isLoading}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
          >
            <ul>
              {userMediaStatusEntries.map((btn) => (
                <li key={btn.value}>
                  <motion.button
                    data-active={mediaStatus == btn.value}
                    disabled={isLoading}
                    onClick={() =>
                      handleAddMediaOnList({
                        status:
                          btn.value as MediaData["mediaListEntry"]["status"],
                      })
                    }
                    whileTap={{ scale: 0.9 }}
                  >
                    Set as {btn.name}
                  </motion.button>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </React.Fragment>
  );
}

export function SvgIcon({ children }: { children: React.ReactNode }) {
  return children;
}
