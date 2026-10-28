import React from "react";
import { cookies } from "next/headers";
import * as anilistMedias from "@/app/lib/anilist/medias.server";
import styles from "../../footerComponent.module.css";
import Link from "next/link";
import { displayTitle } from "@/app/lib/titles";

async function AiringThisWeek() {
  const accessTokenCookie = cookies().get("access_token")?.value;

  const userAuthorization = accessTokenCookie
    ? JSON.parse(accessTokenCookie).accessToken
    : undefined;

  const animesReleasingList = await anilistMedias.getReleasingThisWeek({
    type: "ANIME",
    accessToken: userAuthorization,
  });

  return (
    <div className={styles.list_container}>
      <h5>Airing This Week</h5>

      <ul className={`${styles.grid_template} display_grid`}>
        {animesReleasingList ? (
          animesReleasingList.slice(0, 10).map((media, key) => (
            <li key={key}>
              <Link href={`/media/${media.id}`}>
                {displayTitle(media.title)}
              </Link>
            </li>
          ))
        ) : (
          <li>No Results</li>
        )}
      </ul>
    </div>
  );
}

export default AiringThisWeek;
