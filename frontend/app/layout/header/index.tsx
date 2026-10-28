import React from "react";
import styles from "./headerComponent.module.css";
import ChevronDownIcon from "@/public/assets/chevron-down.svg";
import Link from "next/link";
import AnimeNavListHover from "./components/AnimeNavListHover";
import MangaNavListHover from "./components/MangaNavListHover";
import UserSideMenu from "./components/User/UserSideMenu";
import SearchFormContainer from "./components/SearchFormContainer";
import NotificationsContainer from "./components/Notifications";

function Header() {
  return (
    <header id={styles.background}>
      <div
        id={styles.container}
        className="display_flex_row padding_16px"
      >
        {/* LEFT: LOGO */}
        <div
          id={styles.menu_and_logo_container}
          className="display_flex_row align_items_center"
        >
          <Link href="/" id={styles.img_container}>
            <picture>
              <source
                media="(max-width: 575px)"
                srcSet="/kumoritv-wordmark-dark.svg"
              />

              <img
                id={styles.logo}
                src="/logo-mark.svg"
                alt="KumoriTV logo"
                className={styles.logo_image}
              />
            </picture>
          </Link>
        </div>

        {/* CENTRE: DESKTOP NAVIGATION */}
        <nav
          id={styles.navbar_container}
          aria-label="Main navigation"
        >
          <ul className="display_grid">
            <li className="display_flex_row align_items_center">
              <span>Animes</span>

              <ChevronDownIcon
                alt="Open Animes List"
                width={16}
                height={16}
              />

              <AnimeNavListHover />
            </li>

            <li className="display_flex_row align_items_center">
              <span>Mangas</span>

              <ChevronDownIcon
                alt="Open Mangas List"
                width={16}
                height={16}
              />

              <MangaNavListHover />
            </li>
          </ul>
        </nav>

        {/* RIGHT: SEARCH, NOTIFICATIONS AND LOGIN */}
        <div
          id={styles.user_and_search_container}
          className="display_flex_row align_items_center"
        >
          <SearchFormContainer />

          <NotificationsContainer />

          <UserSideMenu />
        </div>
      </div>
    </header>
  );
}

export default Header;
