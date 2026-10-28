import { useUser } from "@/app/lib/supabase/AuthProvider";
import * as AddToFavourites from "@/app/components/Buttons/AddToFavourites";
import { userMediaStatusEntries } from "@/app/lib/dataConstants/anilist";
import anilistUsers from "@/app/api/anilist/anilistUsers";
import { useAppSelector } from "@/app/lib/redux/hooks";
import { getListStatus, removeFromList, setListStatus } from "@/app/lib/user-data/lists";
import FavouriteSvgFill from "@/public/assets/heart-fill.svg";
import FavouriteSvg from "@/public/assets/heart.svg";
import CheckFillSvg from "@/public/assets/check-circle-fill.svg";
import XSvg from "@/public/assets/x.svg";
import CheckSvg from "@/public/assets/check-circle.svg";
import styles from "./component.module.css";
import { MediaData } from "@/app/ts/interfaces/anilistMediaData";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { KeepWatchingMediaData } from "@/app/ts/interfaces/firestoreData";
import { MediaOnJSONFile } from "@/app/ts/interfaces/jsonMediaData";
import { displayTitle } from "@/app/lib/titles";

const framerMotionOpenPanelTransition = {
  initial: {
    opacity: 0,
    y: 100,
  },
  animate: {
    opacity: 1,
    y: 0,
  },
  exit: {
    opacity: 0,
    y: 100,
  },
};

export default function OptionsPanel({
  isPanelOpen,
  setIsPanelOpen,
  isFavourite,
  mediaListEntryInfo,
  mediaTitle,
  mediaInfo,
  amountWatchedOrRead,
  toggleLoginModalVisibility,
}: {
  isPanelOpen: boolean;
  setIsPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isFavourite: boolean | undefined;
  mediaListEntryInfo: MediaData["mediaListEntry"] | null;
  mediaTitle: MediaData["title"];
  mediaInfo: MediaData | MediaOnJSONFile | KeepWatchingMediaData;
  toggleLoginModalVisibility: () => void;
  amountWatchedOrRead?: number;
}) {
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const [mediaStatus, setMediaStatus] = useState<
    MediaData["mediaListEntry"]["status"] | null
  >(mediaListEntryInfo?.status || null);

  const anilistUser = useAppSelector((state) => state.UserInfo.value);

  const { user } = useUser();

  useEffect(() => {
    if (!mediaInfo.mediaListEntry?.status) {
      void isMediaOnUserLists();
    }
  }, [mediaListEntryInfo?.status, user, anilistUser]);

  // IF MEDIA ID MATCHS ANY RESULT ON DB, IT SETS THIS COMPONENT BUTTON AS ACTIVE
  async function isMediaOnUserLists() {
    const savedStatus = await getListStatus(mediaInfo.id);

    if (!savedStatus) return;

    const matchingEntry = userMediaStatusEntries.find(
      (btn) => btn.value.toLowerCase() == savedStatus.status.toLowerCase()
    );

    if (matchingEntry) setMediaStatus(matchingEntry.value);
  }

  async function handleAddMediaOnList({
    status,
  }: {
    status: MediaData["mediaListEntry"]["status"];
  }) {
    // Opens Login Modal
    if (!user && !anilistUser) return toggleLoginModalVisibility();

    setIsLoading(true);

    const mediaData = {
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

    // Remove from curr list
    if (mediaStatus) {
      const isSameStatus = mediaStatus.toLowerCase() == status.toLowerCase();

      await removeFromList(mediaInfo.id);

      // Remove from anilist list
      if (mediaListEntryInfo && anilistUser && isSameStatus) {
        try {
          await anilistUsers.removeMediaFromSelectedList({
            listItemEntryId: mediaListEntryInfo.id,
          });
        } catch {
          // AniList sync is best effort
        }

        setIsLoading(false);

        setMediaStatus(null);

        return;
      }
    }

    await setListStatus({
      snapshot: mediaData,
      status: status,
      progress:
        status == "COMPLETED"
          ? (mediaInfo as MediaData).episodes
          : amountWatchedOrRead || 0,
      totalEpisodes: (mediaInfo as MediaData).episodes,
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
    <motion.div
      data-disabled-scroll={
        window.matchMedia("(max-width: 768px)").matches ? true : false
      }
      className={styles.options_panel_overlay}
      onClick={() => setIsPanelOpen(!isPanelOpen)}
      variants={framerMotionOpenPanelTransition}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <motion.div
        onClick={(e) => e.stopPropagation()}
        className={styles.options_panel}
      >
        <div className={styles.panel_heading}>
          <h5>{displayTitle(mediaTitle)}</h5>

          <motion.button
            onClick={() => setIsPanelOpen(!isPanelOpen)}
            whileTap={{ scale: 0.9 }}
            aria-label="Close Menu"
          >
            <XSvg />
          </motion.button>
        </div>

        <ul>
          <li>
            <AddToFavourites.Button
              isActiveOnAnilist={isFavourite}
              mediaInfo={mediaInfo}
              customText={isFavourite ? "On Favourites" : "Add to Favourites"}
            >
              <AddToFavourites.SvgIcon>
                <FavouriteSvg fill="var(--brand-color)" />
              </AddToFavourites.SvgIcon>

              <AddToFavourites.SvgIcon>
                <FavouriteSvgFill fill="var(--brand-color)" />
              </AddToFavourites.SvgIcon>
            </AddToFavourites.Button>
          </li>
          {userMediaStatusEntries.map((btn) => (
            <li key={btn.value}>
              <motion.button
                data-active={mediaStatus == btn.value}
                disabled={isLoading}
                onClick={() => handleAddMediaOnList({ status: btn.value })}
                whileTap={{ scale: 0.9 }}
              >
                {mediaStatus == btn.value ? (
                  <>
                    <CheckFillSvg /> Setted as {btn.name}
                  </>
                ) : (
                  <>
                    <CheckSvg /> Set as {btn.name}
                  </>
                )}
              </motion.button>
            </li>
          ))}
        </ul>
      </motion.div>
    </motion.div>
  );
}
