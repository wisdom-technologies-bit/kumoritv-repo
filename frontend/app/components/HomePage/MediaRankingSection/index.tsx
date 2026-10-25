// @ts-nocheck
"use client";
import React, { useState } from "react";
import styles from "./component.module.css";
import * as MediaCard from "../../MediaCards/MediaCard";
import * as MediaCardClientSide from "../../MediaCards/MediaCard/variantClientSide";
import NavigationButtons from "../../NavigationButtons";
import { MediaData } from "@/app/ts/interfaces/anilistMediaData";
import anilist from "@/app/api/anilist/anilistMedias";
import { AnimatePresence, motion } from "framer-motion";
import simulateRange from "@/app/lib/simulateRange";

export const revalidate = 1800; // revalidate cached data every 30 min

const framerMotionShowUpItemVariant = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
};

function MediaRankingSection({
  initialAnimesList,
}: {
  initialAnimesList: void | MediaData[];
}) {
  const [mediaList, setMediaList] = useState<MediaData[] | null>(
    initialAnimesList as MediaData[]
  );
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const [currFormat, setCurrFormat] = useState<"ANIME" | "MANGA">("ANIME");

  const fetchMediasByFormat: (format: "ANIME" | "MANGA") => void = async (
    format: "ANIME" | "MANGA"
  ) => {
    setIsLoading(true);

    const listMediaByFormat = (await anilist.getMediaForThisFormat({
      type: format,
    })) as MediaData[];

    setCurrFormat(format);

    setMediaList(listMediaByFormat as MediaData[]);

    setIsLoading(false);
  };

  return (
    <div id={styles.rank_container}>
      <div className={styles.title_navbar_container}>
        <h3>Top 10 This Week</h3>

        <NavigationButtons
          propsFunction={
            fetchMediasByFormat as (parameter: string | number) => void
          }
          currValue={currFormat}
          buttonOptions={[
            { name: "Animes", value: "ANIME" },
            { name: "Mangas", value: "MANGA" },
          ]}
        />
      </div>

      <motion.ol data-loading={isLoading}>
        <AnimatePresence>
          {isLoading &&
            simulateRange(10).map((item, key) => (
              <motion.span
                key={key}
                className={styles.loading_span}
                variants={framerMotionShowUpItemVariant}
                initial="initial"
                animate="animate"
                exit="initial"
              />
            ))}

          {!isLoading &&
            mediaList &&
            mediaList!.slice(0, 10).map((media, key) => (
              <MediaCardClientSide.ListItemContainer
                key={key}
                positionIndex={key + 1}
                variants={framerMotionShowUpItemVariant}
              >
                <MediaCard.MediaInfo mediaInfo={media} />
              </MediaCardClientSide.ListItemContainer>
            ))}
        </AnimatePresence>
      </motion.ol>
    </div>
  );
}

export default MediaRankingSection;
