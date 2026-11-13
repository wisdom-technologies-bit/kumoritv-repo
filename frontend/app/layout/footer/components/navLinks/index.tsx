import Link from "next/link";
import React, { Suspense } from "react";
import animesGenres from "@/app/data/animeGenres.json";
import styles from "../../footerComponent.module.css";
import AiringThisWeek from "./airingThisWeek";
import { isCommunityEnabled } from "@/app/lib/community/flag";

function NavLinks() {
  // Prompt 38B: the only footer entry the community gets. Read per request, so
  // flipping COMMUNITY_ENABLED needs no rebuild.
  const showCommunity = isCommunityEnabled();

  return (
    <div id={styles.nav_links_container}>
      <div className={styles.list_container}>
        <h5>Categories</h5>

        <ul className={`${styles.grid_template} display_grid`}>
          {animesGenres.map((media) => (
            <li key={media.value}>
              <Link href={`/search?genre=[${media.value}]`}>{media.name}</Link>
            </li>
          ))}
        </ul>
      </div>

      <Suspense
        fallback={
          <div className={`${styles.list_container} ${styles.placeholder}`}>
            <span className={styles.heading_placeholder}></span>

            <ul
              className={`${styles.grid_template} ${styles.list_placeholder} display_grid`}
            >
              {Array.from({ length: 11 - (0 + 1) }, (_, i) => i).map((key) => (
                <li key={key} className={styles.list_item_placeholder}></li>
              ))}
            </ul>
          </div>
        }
      >
        <AiringThisWeek />
      </Suspense>

      <div className="display_flex_row">
        <span id={styles.span_border2}></span>

        <div id={styles.div_custom_margin}>
          <h5>Explore</h5>

          <ul>
            <li>
              <Link href="/">Home</Link>
            </li>
            <li>
              <Link href="/schedule">Release Schedule</Link>
            </li>
            <li>
              <Link href="/search?type=tv">Search Anime</Link>
            </li>
            <li>
              <Link href="/search?type=manga">Search Manga</Link>
            </li>
            {showCommunity && (
              <li>
                <Link href="/community">Community</Link>
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

export default NavLinks;
