"use client";
import { useUser } from "@/app/lib/supabase/AuthProvider";
import React, { useEffect, useState } from "react";
import CheckSvg from "@/public/assets/check-circle.svg";
import CheckFillSvg from "@/public/assets/check-circle-fill.svg";
import styles from "./component.module.css";
import { AnimatePresence, motion } from "framer-motion";
import { useAppSelector } from "@/app/lib/redux/hooks";
import anilistUsers from "@/app/api/anilist/anilistUsers";

// Manga comes in a later prompt: chapters stay on a local-only path for now.
// No Firestore calls here anymore, and the button must never crash.
const CHAPTERS_KEY = "kumori_chapters_read_v1";

type ChapterRecord = {
  mediaId: number;
  chapterNumber: number;
  chapterTitle: string;
};

function readAll(): Record<string, ChapterRecord[]> {
  try {
    if (typeof window === "undefined") return {};
    const parsed = JSON.parse(window.localStorage.getItem(CHAPTERS_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(value: Record<string, ChapterRecord[]>) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(CHAPTERS_KEY, JSON.stringify(value));
    window.dispatchEvent(new Event("kumori-chapters-change"));
  } catch {
    /* ignore */
  }
}

export function isChapterRead(mediaId: number, chapterNumber: number): boolean {
  return Boolean(
    readAll()[String(mediaId)]?.find(
      (item) => Number(item.chapterNumber) === Number(chapterNumber)
    )
  );
}

export function markChapterRead(
  mediaId: number,
  chapterNumber: number,
  chapterTitle: string,
  value = true
): void {
  const all = readAll();
  const current = all[String(mediaId)] || [];
  const withoutChapter = current.filter(
    (item) => Number(item.chapterNumber) !== Number(chapterNumber)
  );
  all[String(mediaId)] = value
    ? [...withoutChapter, { mediaId, chapterNumber, chapterTitle }]
    : withoutChapter;
  writeAll(all);
}

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
    if (wasChapterReadOnAnilist) return setWasChapterRead(true);

    setWasChapterRead(isChapterRead(mediaId, chapterNumber));
  }, [user, anilistUser, chapterNumber, chapterNumber, mediaId]);

  async function handleChapterReadAction() {
    if (!user && !anilistUser) return;

    setIsLoading(true);

    const wasRead = wasChapterRead;

    // optimistic UI, rolled back when the write fails
    setWasChapterRead(!wasRead);

    try {
      markChapterRead(mediaId, chapterNumber, chapterTitle, !wasRead);
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
