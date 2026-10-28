"use client";
import { useUser } from "@/app/lib/supabase/AuthProvider";
import React, { useEffect, useState } from "react";
import styles from "./component.module.css";
import * as MediaCard from "@/app/components/MediaCards/MediaCard";
import SvgLoading from "@/public/assets/Eclipse-1s-200px.svg";
import SvgCaretDown from "@/public/assets/chevron-down.svg";
import { useAppDispatch, useAppSelector } from "@/app/lib/redux/hooks";
import {
  KeepWatchingMediaData,
  ListItemOnMediasSaved,
} from "@/app/ts/interfaces/firestoreData";
import { MediaData } from "@/app/ts/interfaces/anilistMediaData";
import { toggleShowLoginModalValue } from "@/app/lib/redux/features/loginModal";
import { AnimatePresence, motion } from "framer-motion";
import { LIST_STATUSES, listByStatus, toAnilistStatus } from "@/app/lib/user-data/lists";
import type { ListEntry } from "@/app/lib/user-data/types";
import { listContinueWatchingFromServer } from "@/app/lib/user-data/progress";
import { displayTitle } from "@/app/lib/titles";

type ComponentTypes = {
  mediaFetched:
    | {
      name: string;
      status: string;
      entries: {
        id: number;
        userId: number;
        mediaId: number;
        media: MediaData;
      }[];
    }[]
    | undefined;
  params?: {
    format: string;
    type: "tv" | "movie" | "manga";
    sort: "title_desc" | "title_asc";
  };
};

export default function MediasContainer({
  mediaFetched,
  params,
}: ComponentTypes) {
  const [keepWatchingList, setKeepWatchingList] = useState<
    KeepWatchingMediaData[]
  >([]);
  const [userLists, setUserLists] = useState<
    { name: string; medias: ListItemOnMediasSaved[] }[]
  >([]);

  const anilistUser = useAppSelector(
    (state) => state.UserInfo?.value as UserAnilist
  );

  const { user, loading } = useUser();

  const dispatch = useAppDispatch();

  useEffect(() => {
    if (user?.id || anilistUser?.id) getUserLists();
  }, [user, anilistUser]);

  useEffect(() => {
    if (!user && !anilistUser && !loading)
      dispatch(toggleShowLoginModalValue());
  }, [user, anilistUser, loading]);

  function toListCard(entry: ListEntry): ListItemOnMediasSaved {
    return {
      id: entry.id,
      title: {
        ...entry.snapshot.title,
        userPreferred: displayTitle(entry.snapshot.title),
      },
      description: entry.snapshot.description,
      format: entry.snapshot.format,
      isFavourite: false,
      mediaListEntry: {
        id: 0,
        mediaId: entry.id,
        status: toAnilistStatus(entry.status),
        progress: entry.progress,
        media: { title: { romaji: entry.snapshot.title.romaji } },
      },
      coverImage: {
        extraLarge: entry.snapshot.coverImage.extraLarge,
        large: entry.snapshot.coverImage.large,
      },
    } as ListItemOnMediasSaved;
  }

  async function getUserLists() {
    // Keep Watching: latest incomplete progress per anime (Supabase or local).
    setKeepWatchingList(await listContinueWatchingFromServer());

    if (!anilistUser) {
      const lists = await listByStatus();

      const activityLists: { name: string; medias: ListItemOnMediasSaved[] }[] =
        LIST_STATUSES.filter((status) => lists[status].length > 0).map(
          (status) => ({
            name: status,
            medias: lists[status].map(toListCard),
          })
        );

      setUserLists(activityLists);
    }
  }

  return (
    <div id={styles.container}>
      {(params?.type == null || params?.type == "tv") && (
        <KeepWatchingListSection
          keepWatchingList={keepWatchingList}
          loading={loading}
        />
      )}

      {user &&
        userLists &&
        params?.type != "MANGA".toLowerCase() &&
        userLists.map((list) => (
          <MediasListOnUserDoc userList={list} key={list.name} />
        ))}

      {anilistUser &&
        mediaFetched &&
        mediaFetched.map((list) => (
          <MediasListOnAnilist list={list} key={list.name} />
        ))}
    </div>
  );
}

function KeepWatchingListSection({
  keepWatchingList,
  loading,
}: {
  keepWatchingList: KeepWatchingMediaData[];
  loading: boolean;
}) {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);

  return (
    <div className={styles.list_container} id="keep-watching">
      <h2 onClick={() => setIsCollapsed(!isCollapsed)}>
        KEEP WATCHING
        <SvgCaretDown data-inverted={isCollapsed} />
      </h2>

      {loading && (
        <div style={{ height: "400px", width: "100%", display: "flex" }}>
          <SvgLoading width={120} height={120} style={{ margin: "auto" }} />
        </div>
      )}

      <AnimatePresence>
        {!isCollapsed && (
          <motion.ul>
            {!keepWatchingList && <li>No media in keep watching list</li>}

            {keepWatchingList?.map((media) => (
              <li key={media.id}>
                <MediaCard.Container onDarkMode>
                  <MediaCard.MediaImgLink
                    hideOptionsButton
                    mediaInfo={media}
                    mediaId={media.id}
                    title={displayTitle(media.title)}
                    formatOrType={media.format}
                    url={media.coverImage.extraLarge}
                  />

                  <MediaCard.LinkTitle
                    title={displayTitle(media.title)}
                    id={media.id}
                  />
                </MediaCard.Container>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

function MediasListOnUserDoc({
  userList,
}: {
  userList: { name: string; medias: ListItemOnMediasSaved[] };
}) {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);

  return (
    <div className={styles.list_container} id={userList.name.toLowerCase()}>
      <h2 onClick={() => setIsCollapsed(!isCollapsed)}>
        {userList.name == "current" ? "WATCHING" : userList.name.toUpperCase()}
        <SvgCaretDown data-inverted={isCollapsed} />
      </h2>

      <AnimatePresence>
        {!isCollapsed && (
          <motion.ul>
            {userList.medias.map((entrie, key) => (
              <li key={key}>
                <MediaCard.Container onDarkMode>
                  <MediaCard.MediaImgLink
                    hideOptionsButton
                    mediaInfo={entrie as MediaData}
                    mediaId={entrie.id}
                    title={displayTitle(entrie.title)}
                    formatOrType={entrie.format}
                    url={entrie.coverImage.extraLarge}
                  />

                  <MediaCard.LinkTitle
                    title={displayTitle(entrie.title)}
                    id={entrie.id}
                  />
                </MediaCard.Container>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

function MediasListOnAnilist({
  list,
}: {
  list: {
    name: string;
    status: string;
    entries: {
      id: number;
      userId: number;
      mediaId: number;
      media: MediaData;
    }[];
  };
}) {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);

  return (
    <div
      key={list.name}
      className={styles.list_container}
      id={list.status?.toLowerCase() || "custom"}
    >
      <h2 onClick={() => setIsCollapsed(!isCollapsed)}>
        {list.name.toUpperCase()}
        <SvgCaretDown data-inverted={isCollapsed} />
      </h2>

      <AnimatePresence>
        {!isCollapsed && (
          <motion.ul
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
          >
            {list.entries.map((entrie, key) => (
              <li key={key}>
                <MediaCard.Container onDarkMode>
                  <MediaCard.MediaImgLink
                    mediaInfo={entrie.media as MediaData}
                    mediaId={entrie.media.id}
                    title={displayTitle(entrie.media.title)}
                    formatOrType={entrie.media.format}
                    url={entrie.media.coverImage.extraLarge}
                  />

                  <MediaCard.LinkTitle
                    title={displayTitle(entrie.media.title)}
                    id={entrie.media.id}
                  />
                </MediaCard.Container>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
