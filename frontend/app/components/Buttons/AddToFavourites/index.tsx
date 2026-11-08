"use client";
import { useUser } from "@/app/lib/supabase/AuthProvider";
import React, { useEffect, useState } from "react";
import styles from "./component.module.css";
import LoadingSvg from "@/public/assets/ripple-1s-200px.svg";
import FavouriteSvg from "@/public/assets/heart.svg";
import FavouriteFillSvg from "@/public/assets/heart-fill.svg";
import { MediaData } from "@/app/ts/interfaces/anilistMediaData";
import { motion } from "framer-motion";
import { addFavourite, isFavourite, removeFavourite } from "@/app/lib/user-data/favourites";
import { useAppDispatch, useAppSelector } from "@/app/lib/redux/hooks";
import anilistUsers from "@/app/api/anilist/anilistUsers";
import { toggleShowLoginModalValue } from "@/app/lib/redux/features/loginModal";
import { KeepWatchingMediaData } from "@/app/ts/interfaces/firestoreData";
import { MediaOnJSONFile } from "@/app/ts/interfaces/jsonMediaData";
import { displayTitle } from "@/app/lib/titles";

export function Button({
  mediaInfo,
  children,
  svgOnlyColor,
  isActiveOnAnilist,
  customText,
  variant = "pill",
}: {
  mediaInfo: MediaData | MediaOnJSONFile | KeepWatchingMediaData;
  children?: React.ReactNode[];
  svgOnlyColor?: string;
  isActiveOnAnilist?: boolean;
  customText?: string;
  /** "round" = the shared icon circle (media hero / watch card). */
  variant?: "pill" | "round";
}) {
  const isRound = variant === "round";
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [wasAddedToFavourites, setWasAddedToFavourites] = useState<boolean>(
    isActiveOnAnilist || false
  );

  const anilistUser = useAppSelector((state) => state.UserInfo.value);

  const dispatch = useAppDispatch();

  const { user, loading } = useUser();

  useEffect(() => {
    if (!loading) {
      void isMediaOnUserFavourites();
    }
  }, [user, anilistUser, loading]);

  // WHEN BUTTON IS CLICKED, ADD OR REMOVE MEDIA FROM FAVOURITES
  async function handleMediaOnFavourites() {
    // Opens Login Modal
    if (!user && !anilistUser) return dispatch(toggleShowLoginModalValue());

    setIsLoading(true);

    const favouriteMediaData = {
      id: mediaInfo.id,
      title: {
        romaji:
          typeof mediaInfo.title === "string"
            ? mediaInfo.title
            : mediaInfo.title.romaji,
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

    const wasAdded = wasAddedToFavourites;

    // optimistic UI, rolled back when the write fails
    setWasAddedToFavourites(!wasAdded);

    const writeSucceeded = wasAdded
      ? await removeFavourite(mediaInfo.id)
      : await addFavourite(favouriteMediaData);

    if (!writeSucceeded) setWasAddedToFavourites(wasAdded);

    try {
      await anilistUsers.addOrRemoveFromAnilistFavourites({
        format: mediaInfo.type.toLowerCase() as "anime" | "manga",
        mediaId: mediaInfo.id,
      });
    } catch {
      // AniList sync is best effort and must not break the local state
    }

    setIsLoading(false);
  }

  // IF MEDIA ID MATCHS ANY RESULT ON DB, IT SETS THIS COMPONENT BUTTON AS ACTIVE
  async function isMediaOnUserFavourites() {
    if (isActiveOnAnilist) return setWasAddedToFavourites(true);

    const favouriteFound = await isFavourite(mediaInfo.id);

    setWasAddedToFavourites(favouriteFound);
  }

  return (
    <motion.button
      whileTap={{ scale: 0.85 }}
      id={isRound ? undefined : styles.container}
      className={
        isRound ? "kumori-round" : children ? styles.custom_text : ""
      }
      onClick={() => handleMediaOnFavourites()}
      disabled={isLoading}
      data-added={wasAddedToFavourites}
      data-unique-color={svgOnlyColor != undefined}
      aria-label={
        wasAddedToFavourites
          ? "Click To Remove from Favourites"
          : "Click To Add To Favourites"
      }
      title={
        wasAddedToFavourites
          ? `Remove ${displayTitle(mediaInfo.title)} from Favourites`
          : `Add ${displayTitle(mediaInfo.title)} To Favourites`
      }
    >
      {isLoading && <LoadingSvg alt="Loading Icon" width={16} height={16} />}

      {!isLoading &&
        wasAddedToFavourites &&
        (children ? (
          children[1]
        ) : (
          <>
            <FavouriteFillSvg
              width={16}
              height={16}
              fill={svgOnlyColor || "var(--brand-color)"}
            />{" "}
            FAVOURITED
          </>
        ))}

      {!isLoading &&
        !wasAddedToFavourites &&
        (children ? (
          children[0]
        ) : (
          <>
            <FavouriteSvg
              width={16}
              height={16}
              fill={svgOnlyColor || "var(--white-100)"}
            />{" "}
            FAVOURITE
          </>
        ))}

      {customText || ""}
    </motion.button>
  );
}

export function SvgIcon({ children }: { children: React.ReactNode }) {
  return children;
}
