"use client";
import { useUser } from "@/app/lib/supabase/AuthProvider";
import React, { useEffect, useState } from "react";
import styles from "./component.module.css";
import LoadingSvg from "@/public/assets/ripple-1s-200px.svg";
import BellFillSvg from "@/public/assets/bell-fill.svg";
import BellSvg from "@/public/assets/bell-slash.svg";
import {
  MediaData,
  MediaDataFullInfo,
} from "@/app/ts/interfaces/anilistMediaData";
import { motion } from "framer-motion";
import { useAppDispatch, useAppSelector } from "@/app/lib/redux/hooks";
import { toggleShowLoginModalValue } from "@/app/lib/redux/features/loginModal";
import {
  isSubscribed,
  subscribe,
  unsubscribe,
} from "@/app/lib/user-data/notifications";
import { displayTitle } from "@/app/lib/titles";

function AddToNotificationsButton({
  mediaInfo,
}: {
  mediaInfo: MediaData | MediaDataFullInfo;
}) {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [wasAddedToNotifications, setWasAddedToNotifications] =
    useState<boolean>(false);

  const anilistUser = useAppSelector((state) => state.UserInfo.value);
  const dispatch = useAppDispatch();

  const { user, loading } = useUser();

  useEffect(() => {
    if (!loading) {
      void isUserAssignedToThisMediaNotications();
    }
  }, [user, anilistUser, loading]);

  const isMediaStillReleasing = mediaInfo.nextAiringEpisode?.airingAt ?? false;

  async function handleMediaOnNotifications() {
    // Guests have nothing to subscribe with: ask them to sign in first.
    if (!user && !anilistUser) return dispatch(toggleShowLoginModalValue());
    if (!user) return dispatch(toggleShowLoginModalValue());

    setIsLoading(true);

    const wasAdded = wasAddedToNotifications;

    // optimistic UI, rolled back when the write fails
    setWasAddedToNotifications(!wasAdded);

    const writeSucceeded = wasAdded
      ? await unsubscribe(mediaInfo.id)
      : await subscribe({
          id: mediaInfo.id,
          title: mediaInfo.title,
          format: mediaInfo.format,
          description: mediaInfo.description,
          coverImage: mediaInfo.coverImage,
        });

    if (!writeSucceeded) setWasAddedToNotifications(wasAdded);

    setIsLoading(false);
  }

  async function isUserAssignedToThisMediaNotications() {
    if (!user) return setWasAddedToNotifications(false);

    const subscribed = await isSubscribed(mediaInfo.id);

    setWasAddedToNotifications(subscribed);
  }

  if (isMediaStillReleasing) {
    return (
      <motion.button
        whileTap={{ scale: 0.85 }}
        id={styles.container}
        onClick={() => handleMediaOnNotifications()}
        disabled={isLoading}
        data-added={wasAddedToNotifications}
        aria-label={
          wasAddedToNotifications
            ? `Remove ${displayTitle(mediaInfo.title)} From Notifications`
            : `Get Notified When ${displayTitle(mediaInfo.title)} Get a New Episode`
        }
        title={
          wasAddedToNotifications
            ? `Remove ${displayTitle(mediaInfo.title)} From Notifications`
            : `Get Notified When ${displayTitle(mediaInfo.title)} Get a New Episode`
        }
      >
        {isLoading && <LoadingSvg alt="Loading Icon" width={16} height={16} />}

        {!isLoading &&
          (wasAddedToNotifications ? (
            <BellFillSvg width={16} height={16} />
          ) : (
            <BellSvg width={16} height={16} />
          ))}
      </motion.button>
    );
  }
}

export default AddToNotificationsButton;
