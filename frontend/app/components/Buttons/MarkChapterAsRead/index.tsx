"use client";
import { useUser } from "@/app/lib/supabase/AuthProvider";
import React, { useEffect, useState } from "react";
import CheckSvg from "@/public/assets/check-circle.svg";
import CheckFillSvg from "@/public/assets/check-circle-fill.svg";
import styles from "./component.module.css";
import { AnimatePresence, motion } from "framer-motion";
import { useAppSelector } from "@/app/lib/redux/hooks";
import anilistUsers from "@/app/api/anilist/anilistUsers";
import { isRead, markRead, subscribeChapters, unmarkRead } from "@/app/lib/user-data/chapters";

// Read marks live in app/lib/user-data/chapters.ts: localStorage for guests,
// Supabase `chapters_read` for signed-in users. The button never crashes.
type BtnTypes = {
  chapterNumber: number;
  chapterTitle: string;
  mediaId: number;
  showAdditionalText?: boolean;
  wasChapterReadOnAnilist?: boolean;
  maxChaptersNumber?: number;
};

export default function MarkChapterAsReadButton({
  chapterNumber,
  chapterTitle,
  mediaId,
  showAdditionalText,
  wasChapterReadOnAnilist,
  maxChaptersNumber,
}: BtnTypes) {
  const [wasChapterRead, setWasChapterRead] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const anilistUser = useAppSelector((state) => state.UserInfo.value);

  const { user } = useUser();

  useEffect(() => {
    if (wasChapterReadOnAnilist) {
      setWasChapterRead(true);
      return;
    }

    let active = true;

    isRead(mediaId, chapterNumber)
      .then((read) => {
        if (active) setWasChapterRead(read);
      })
      .catch(() => {
        /* a failed read just leaves the button unchecked */
      });

    const unsubscribe = subscribeChapters(() => {
      isRead(mediaId, chapterNumber)
        .then((read) => {
          if (active) setWasChapterRead(read);
        })
        .catch(() => {});
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [user, anilistUser, chapterNumber, mediaId, wasChapterReadOnAnilist]);

  async function handleChapterReadAction() {
    if (!user && !anilistUser) return;

    setIsLoading(true);

    const wasRead = wasChapterRead;

    // optimistic UI, rolled back when the write fails
    setWasChapterRead(!wasRead);

    try {
      const saved = wasRead
        ? await unmarkRead(mediaId, chapterNumber)
        : await markRead(mediaId, chapterNumber, {
            snapshot: chapterTitle ? { title: chapterTitle } : null,
          });

      if (!saved) setWasChapterRead(wasRead);
    } catch {
      setWasChapterRead(wasRead);
    }

    if (anilistUser) {
      try {
        await anilistUsers.addMediaToSelectedList({
          mediaId: mediaId,
          status: maxChaptersNumber == chapterNumber ? "COMPLETED" : "CURRENT",
          episodeOrChapterNumber: wasRead ? chapterNumber - 1 : chapterNumber,
        });
      } catch {
        // AniList sync is best effort
      }
    }

    setIsLoading(false);
  }

  return (
    (user || anilistUser) && (
      <div className={styles.button_container}>
        <motion.button
          onClick={() => handleChapterReadAction()}
          data-active={wasChapterRead}
          disabled={isLoading}
          title={wasChapterRead ? "Mark as Unread" : "Mark as Read"}
        >
          <SvgIcons wasChapterRead={wasChapterRead} />
        </motion.button>

        <AuxTextAnimated
          wasChapterRead={wasChapterRead}
          showAdditionalText={showAdditionalText}
        />
      </div>
    )
  );
}

function SvgIcons({ wasChapterRead }: { wasChapterRead: boolean }) {
  if (wasChapterRead) {
    return <CheckFillSvg width={16} height={16} alt="Check Chapter as Read" />;
  }

  return <CheckSvg width={16} height={16} alt="Check Chapter as Unread" />;
}

function AuxTextAnimated({
  showAdditionalText,
  wasChapterRead,
}: {
  wasChapterRead: boolean;
  showAdditionalText?: boolean;
}) {
  return (
    <AnimatePresence>
      {showAdditionalText && wasChapterRead && (
        <motion.span
          className={styles.text_span}
          initial={{ opacity: 0, y: "10px" }}
          animate={{ opacity: 1, y: "0", transition: { duration: 0.2 } }}
          exit={{ opacity: 0, y: "10px" }}
        >
          Read
        </motion.span>
      )}
    </AnimatePresence>
  );
}
