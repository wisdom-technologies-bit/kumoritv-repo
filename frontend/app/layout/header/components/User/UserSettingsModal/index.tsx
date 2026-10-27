import { AnimatePresence, motion } from "framer-motion";
import React, { MouseEventHandler, useState } from "react";
import styles from "./component.module.css";
import CheckSvg from "@/public/assets/check-circle-fill.svg";
import LoadingSvg from "@/public/assets/ripple-1s-200px.svg";
import CloseSvg from "@/public/assets/x.svg";
import UserSvg from "@/public/assets/person-circle.svg";
import VideoSvg from "@/public/assets/play.svg";
import SourceSvg from "@/public/assets/globe2.svg";
import DeleteSvg from "@/public/assets/trash.svg";
import Image from "next/image";
import { createBrowserSupabaseClient } from "@/app/lib/supabase/browser";
import { useUser } from "@/app/lib/supabase/AuthProvider";
import * as contantOptions from "./contantOptions";
import anilistUsersActions from "@/app/api/anilist/anilistUsers";
import userSettingsActions from "@/app/api/cookie/userCookieSettingsActions";
import { removeCookies } from "@/app/lib/user/anilistUserLoginOptions";
import { sourcesAvailable } from "@/app/data/animeSourcesAvailable";
import { getPrefs, setPref } from "@/app/lib/user-data/prefs";
import { clearFavourites } from "@/app/lib/user-data/favourites";
import { clearProgress } from "@/app/lib/user-data/progress";
import { clearNotifications } from "@/app/lib/user-data/notifications";
import { clearUserScopedCaches } from "@/app/lib/user-data/merge";

type SettingsTypes = {
  onClick?:
    | MouseEventHandler<HTMLDivElement>
    | MouseEventHandler<HTMLButtonElement>
    | ((value: void) => void | PromiseLike<void>)
    | null
    | undefined;
  auth?: unknown;
  anilistUser?: UserAnilist | null;
  newUser?: boolean;
};

const framerMotionDropIn = {
  hidden: {
    x: "-100vw",
    opacity: 0,
  },
  visible: {
    x: "0",
    opacity: 1,
    transition: {
      duration: 0.2,
      damping: 25,
      type: "spring",
      stiffness: 500,
    },
  },
  exit: {
    x: "100vw",
    opacity: 0,
  },
};

const framerMotionBtnVariants = {
  tap: {
    scale: 0.9,
  },
};

function UserSettingsModal({
  onClick,
  auth,
  anilistUser,
  newUser,
}: SettingsTypes) {
  const { user: supabaseUser, profile } = useUser();
  const client = createBrowserSupabaseClient();
  const user = supabaseUser ? {
    uid: supabaseUser.id,
    photoURL: profile?.avatar_url || supabaseUser.user_metadata?.avatar_url || null,
    displayName: profile?.display_name || profile?.username || supabaseUser.user_metadata?.username || null,
    isAnonymous: supabaseUser.is_anonymous ?? false,
  } : null;
  const [userAnilist] = useState<UserAnilist | undefined | null>(anilistUser);

  const [isLoading, setIsLoading] = useState(false);
  const [wasSuccessfull, setWasSuccessfull] = useState<boolean | null>(null);

  const [openUserProfilePanel, setOpenUserProfilePanel] =
    useState<boolean>(false);
  const [newImgProfileSelected, setNewImgProfileSelected] = useState<
    string | null
  >(null);

  const [deleteBookmarksClick, setDeleteBookmarksClick] =
    useState<boolean>(false);
  const [deleteEpisodesClick, setDeleteEpisodesClick] =
    useState<boolean>(false);
  const [deleteNotificationsClick, setDeleteNotificationsClick] =
    useState<boolean>(false);
  const [deleteAccountClick, setDeleteAccountClick] = useState<boolean>(false);

  const [currentLang, setCurrentLang] = useState<string | null>(null);
  const [currentSource, setCurrentSource] = useState<string | null>(null);
  const [currentTitleLang, setCurrentTitleLang] = useState<string | null>(null);
  const [currentQuality, setCurrentQuality] = useState<string | null>(null);
  const [currentShowAdultContent, setCurrentShowAdultContent] = useState<
    boolean | null
  >(null);
  const [currentPlayWrongMediaEnabled, setCurrentPlayWrongMediaEnabled] =
    useState<boolean | null>(null);
  const [currentSkipIntroAndOutro, setCurrentSkipIntroAndOutro] = useState<
    boolean | null
  >(null);
  const [currentNextEpisode, setCurrentNextEpisode] = useState<boolean | null>(
    null
  );

  async function handleUpdateUserInfoForm(
    e: React.FormEvent<HTMLFormElement> | HTMLFormElement
  ) {
    e.preventDefault();

    if (!user && !userAnilist) return;

    setIsLoading(true);
    setWasSuccessfull(false);

    const form = e.target as HTMLFormElement;

    if (user && client) {
      const username = user.isAnonymous ? profile?.username : String(form.username.value || "").slice(0, 40);
      const { error } = await (client as any).from("profiles").update({
        username: username || profile?.username,
        display_name: user.isAnonymous ? "Anonymous" : username || profile?.display_name,
        avatar_url: newImgProfileSelected || profile?.avatar_url,
        title_language: form.mediaTitlePreferredLang.value,
        subtitle_language: form.language.value,
        preferred_audio: form.source.value,
        video_quality: form.quality.value,
        auto_next: form.autoNextEpisode.checked,
        auto_skip: form.skipIntroAndOutro.checked,
      }).eq("id", user.uid);
      if (error) throw error;
    }

    // Playback preferences: profiles table when signed in, localStorage for guests
    // (an AniList-only user has no Supabase session and behaves as a guest).
    await setPref("autoNext", form.autoNextEpisode.checked);
    await setPref("autoSkip", form.skipIntroAndOutro.checked);
    await setPref("subtitle_language", form.language.value);

    await (onClick as ((value: void) => void | PromiseLike<void>) | null | undefined)?.();

    if (userAnilist) {
      await anilistUsersActions.handleMediaTitleLanguageSetting({
        lang: form.mediaTitlePreferredLang.value,
      });

      await anilistUsersActions.handleAdultContentSetting({
        isEnabled: `${form.showAdultContent.checked}`,
      });

      await anilistUsersActions.handleSubtitleLanguageSetting({
        lang: form.language.value,
      });

      await anilistUsersActions.handlePlayWrongMediaSetting({
        isEnabled: `${form.playVideoWhenMismatch.checked}`,
      });
    } else {
      await userSettingsActions.setMediaTitleLanguageCookie({
        lang: form.mediaTitlePreferredLang.value,
      });

      await userSettingsActions.setSubtitleLanguageCookie({
        lang: form.language.value,
      });

      await userSettingsActions.setPlayWrongMediaCookie({
        playWrongMedia: `${form.playVideoWhenMismatch.checked}`,
      });
    }

    setIsLoading(false);
    setWasSuccessfull(true);
  }

  async function deleteOptions(
    option: "account" | "bookmarks" | "notifications" | "episodes"
  ) {
    if (!user && !userAnilist) return;

    setIsLoading(true);
    setWasSuccessfull(false);

    switch (option) {
      case "bookmarks":
        await clearFavourites();

        setIsLoading(false);
        setWasSuccessfull(true);

        break;

      case "episodes":
        await clearProgress();

        setIsLoading(false);
        setWasSuccessfull(true);

        break;

      case "notifications":
        await clearNotifications();

        setIsLoading(false);
        setWasSuccessfull(true);

        break;

      case "account":
        if (user) {
          const response = await fetch("/api/account/delete", { method: "POST" });
          if (!response.ok) throw new Error("Unable to delete account");
          await client?.auth.signOut();
        } else {
          clearUserScopedCaches();
          removeCookies();
        }
        window.location.href = "/";
        break;

      default:
        return;
    }
  }

  (async function getUserSavedSettings() {
    if (!user && !userAnilist) return;

    const prefs = await getPrefs();

    setCurrentLang(prefs.subtitle_language || "English");
    setCurrentSource(currentSource || "crunchyroll");
    setCurrentTitleLang(profile?.title_language || "romaji");
    setCurrentQuality(profile?.video_quality || "auto");
    // Adult-content preference is no longer read from the database anywhere.
    setCurrentShowAdultContent(false);
    setCurrentSkipIntroAndOutro(prefs.autoSkip);
    setCurrentNextEpisode(prefs.autoNext);
    setCurrentPlayWrongMediaEnabled(false);
  })();

  return (
    <motion.div
      id={styles.backdrop}
      onClick={
        !newUser ? (onClick as MouseEventHandler<HTMLDivElement>) : undefined
      }
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      data-disabled-scroll={true}
    >
      <motion.div
        onClick={(e) => e.stopPropagation()}
        id={styles.modal}
        variants={framerMotionDropIn}
        initial="hidden"
        animate="visible"
        exit="exit"
      >
        <div className={styles.settings_heading}>
          <h2>Configure Your Account</h2>

          {!newUser && (
            <motion.button
              title="Close Settings"
              onClick={onClick as MouseEventHandler<HTMLButtonElement>}
              id={styles.close_menu_btn}
              variants={framerMotionBtnVariants}
              whileTap={"tap"}
            >
              <CloseSvg alt="Close" width={16} height={16} />
            </motion.button>
          )}
        </div>

        {user?.isAnonymous && (
          <div id={styles.anonymous_disclaimer_container}>
            <h5>You are in Anonymous Mode!</h5>
            <p>
              In this mode you <b>can not</b> make Comments or change your
              Username.
            </p>
          </div>
        )}

        <form onSubmit={(e) => handleUpdateUserInfoForm(e)}>
          <div className={styles.group_container}>
            <h5>
              <span>
                <UserSvg alt="Person" width={16} height={16} />
              </span>{" "}
              User
            </h5>

            {anilistUser && (
              <small
                style={{
                  textAlign: "center",
                  fontSize: "var(--font-size--small-1)",
                }}
              >
                You only may change Username and Photo on{" "}
                <a
                  target="_blank"
                  rel="noopener noreferrer"
                  href={`https://anilist.co/user/${anilistUser.name}`}
                  style={{
                    display: "inline-block",
                    fontSize: "var(--font-size--small-1)",
                    textDecoration: "underline",
                  }}
                >
                  <b>AniList Website</b>
                </a>
              </small>
            )}

            <div className={`${styles.user_acc_info_container}`}>
              <div>
                {(user || anilistUser) && (
                  <>
                    <label
                      id={styles.img_container}
                      data-disabled={anilistUser != undefined}
                      onClick={() =>
                        user
                          ? setOpenUserProfilePanel(!openUserProfilePanel)
                          : undefined
                      }
                    >
                      <Image
                        aria-label="Change Profile Image"
                        src={
                          user?.photoURL ||
                          (anilistUser?.avatar.large as string)
                        }
                        alt={user?.displayName || (anilistUser?.name as string)}
                        fill
                        sizes="(max-width: 400px) 95vw, (max-width: 520px) 109px, 140px"
                      />
                    </label>
                  </>
                )}
              </div>

              <div>
                {(user || anilistUser) && (
                  <React.Fragment>
                    <label>
                      Change Username
                      <input
                        type="text"
                        name="username"
                        disabled={
                          user?.isAnonymous || anilistUser?.isUserFromAnilist
                        }
                        defaultValue={user?.displayName || anilistUser?.name}
                        placeholder={user?.displayName || anilistUser?.name}
                        required
                        title="Only letters and numbers."
                      ></input>
                    </label>

                    {user?.isAnonymous && (
                      <small>
                        Can not change while <b>Anonymous</b>
                      </small>
                    )}
                  </React.Fragment>
                )}
                <AnimatePresence initial={false} mode="wait">
                  {newImgProfileSelected && (
                    <motion.small
                      initial={{ opacity: 0, height: 0, marginTop: "8px" }}
                      animate={{
                        opacity: 1,
                        height: "auto",
                        transition: { duration: 0.4 },
                      }}
                      exit={{ opacity: 0, height: 0, marginTop: "0" }}
                      style={{
                        height: "100%",
                        display: "block",
                        marginTop: "24px",
                        color: "#2e882b",
                        fontWeight: "500",
                      }}
                    >
                      New Image Selected!
                    </motion.small>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* IMAGES PANEL */}
            <AnimatePresence initial={false} mode="wait">
              {openUserProfilePanel && (
                <motion.div
                  initial={{
                    opacity: 0,
                    height: 0,
                    marginTop: "8px",
                    marginBottom: "40px",
                  }}
                  animate={{
                    opacity: 1,
                    height: "auto",
                    transition: { duration: 0.4 },
                  }}
                  exit={{
                    opacity: 0,
                    height: 0,
                    marginTop: "0",
                    marginBottom: "0",
                  }}
                  id={styles.imgs_panel_container}
                >
                  {contantOptions.imagesOptions.map((item, key) => (
                    <motion.div
                      key={key}
                      className={styles.img_checkbox}
                      variants={framerMotionBtnVariants}
                      whileTap={"tap"}
                    >
                      <input
                        type="checkbox"
                        name="photoURL"
                        value={item.value}
                        checked={
                          newImgProfileSelected
                            ? newImgProfileSelected == item.value
                            : false
                        }
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        onClick={(e: any) =>
                          setNewImgProfileSelected(
                            newImgProfileSelected == e.target.value
                              ? null
                              : e.target.value
                          )
                        }
                      ></input>
                      <Image
                        src={item.value}
                        alt={item.name}
                        fill
                        sizes="(max-width: 479px) 30vw, 101px"
                      />
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className={styles.group_container}>
            <h5>
              <span>
                <VideoSvg alt="Play" width={16} height={16} />
              </span>{" "}
              Video
            </h5>

            <div>
              {currentLang && (
                <label>
                  Subtitle Language
                  <select name="language" defaultValue={currentLang}>
                    {contantOptions.languagesOptions.map((language) => (
                      <option key={language.value} value={language.value}>
                        {language.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <small>
                Only works with <b>Aniwatch</b>
              </small>
            </div>

            <div>
              {currentQuality && (
                <label>
                  <span>
                    Preferable Video Quality{" "}
                    <span
                      style={{
                        padding: "4px",
                        background: "var(--brand-color)",
                        color: "var(--white-100)",
                      }}
                    >
                      BETA
                    </span>
                  </span>
                  <select name="quality" defaultValue={currentQuality}>
                    {contantOptions.qualityOptions.map((quality) => (
                      <option key={quality.name} value={quality.value}>
                        {quality.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <small>
                Some videos <b>may not have the quality selected</b>. By that,
                the video will be displayed with the default quality.
              </small>
            </div>

            <div>
              {currentSkipIntroAndOutro != null && (
                <>
                  <div className={styles.checkbox_container}>
                    <label>
                      <input
                        type="checkbox"
                        name="skipIntroAndOutro"
                        defaultChecked={
                          (currentSkipIntroAndOutro == true) as boolean
                        }
                      ></input>
                      <span />
                    </label>
                    <p>
                      Skip Openings And Endings (<b>Aniwatch only!</b>)
                    </p>
                  </div>

                  {/* <small style={{ marginTop: "16px", display: "block" }}>Only works with <b>Aniwatch</b></small> */}
                </>
              )}
            </div>

            <div>
              {currentNextEpisode != null && (
                <>
                  <div className={styles.checkbox_container}>
                    <label>
                      <input
                        type="checkbox"
                        name="autoNextEpisode"
                        defaultChecked={(currentNextEpisode == true) as boolean}
                      ></input>
                      <span />
                    </label>
                    <p>Auto Play Next Episode</p>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className={styles.group_container}>
            <h5>
              <span>
                <SourceSvg alt="Globe" width={16} height={16} />
              </span>{" "}
              Source
            </h5>

            <div>
              {currentTitleLang && (
                <>
                  <label>
                    Media Title Language
                    <select
                      name="mediaTitlePreferredLang"
                      defaultValue={currentTitleLang}
                    >
                      {contantOptions.titlePrefferedLanguages.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {userAnilist && (
                    <small>
                      Changing this option will also change on your AniList
                      Account
                    </small>
                  )}
                </>
              )}
            </div>

            <div>
              {currentSource && (
                <>
                  <label>
                    Main Source of Episodes
                    <select name="source" defaultValue={currentSource}>
                      {sourcesAvailable.map((source) => (
                        <option key={source.value} value={source.value}>
                          {source.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <small>
                    Focus the anime episodes to the source selected.{" "}
                    <b>You can still use the others sources.</b>
                  </small>
                </>
              )}
            </div>

            <div>
              {currentShowAdultContent != null && (
                <>
                  <div className={styles.checkbox_container}>
                    <label>
                      <input
                        type="checkbox"
                        name="showAdultContent"
                        defaultChecked={
                          (currentShowAdultContent == true) as boolean
                        }
                      ></input>
                      <span />
                    </label>
                    <p>Show Adult Content (+18)</p>
                  </div>

                  {userAnilist && (
                    <small style={{ marginTop: "16px", display: "block" }}>
                      Changing this option will also change on your AniList
                      Account
                    </small>
                  )}
                </>
              )}
            </div>

            <div>
              {currentPlayWrongMediaEnabled != null && (
                <>
                  <div className={styles.checkbox_container}>
                    <label>
                      <input
                        type="checkbox"
                        name="playVideoWhenMismatch"
                        defaultChecked={
                          (currentPlayWrongMediaEnabled == true) as boolean
                        }
                      ></input>
                      <span />
                    </label>
                    <p>{`Don't`} show wrong media alert on Watch Page</p>
                  </div>
                </>
              )}
            </div>
          </div>

          {!newUser && (
            <div>
              <h5 style={{ marginBottom: "16px" }}>
                <span>
                  <DeleteSvg alt="Play" width={16} height={16} />
                </span>{" "}
                Delete
              </h5>

              <div className={styles.btns_container}>
                <label>
                  <motion.button
                    type="button"
                    onClick={() =>
                      setDeleteBookmarksClick(!deleteBookmarksClick)
                    }
                    variants={framerMotionBtnVariants}
                    whileTap="tap"
                    data-active={deleteBookmarksClick}
                  >
                    Delete Favourites
                  </motion.button>
                </label>
                <AnimatePresence initial={false} mode="wait">
                  {deleteBookmarksClick && (
                    <motion.div
                      initial={{
                        opacity: 0,
                        height: 0,
                        marginTop: "8px",
                        marginBottom: "40px",
                      }}
                      animate={{
                        opacity: 1,
                        height: "auto",
                        transition: { duration: 0.4 },
                      }}
                      exit={{
                        opacity: 0,
                        height: 0,
                        marginTop: "0",
                        marginBottom: "0",
                      }}
                      className={styles.confirm_delete_container}
                    >
                      <p>Are you Sure?</p>
                      <button
                        type="button"
                        onClick={() => setDeleteBookmarksClick(false)}
                      >
                        Cancel
                      </button>
                      <button onClick={() => deleteOptions("bookmarks")}>
                        Delete!
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>

                <label>
                  <motion.button
                    type="button"
                    onClick={() => setDeleteEpisodesClick(!deleteEpisodesClick)}
                    variants={framerMotionBtnVariants}
                    whileTap="tap"
                    data-active={deleteEpisodesClick}
                  >
                    Delete Episodes Watched
                  </motion.button>
                </label>
                <AnimatePresence initial={false} mode="wait">
                  {deleteEpisodesClick && (
                    <motion.div
                      initial={{
                        opacity: 0,
                        height: 0,
                        marginTop: "8px",
                        marginBottom: "40px",
                      }}
                      animate={{
                        opacity: 1,
                        height: "auto",
                        transition: { duration: 0.4 },
                      }}
                      exit={{
                        opacity: 0,
                        height: 0,
                        marginTop: "0",
                        marginBottom: "0",
                      }}
                      className={styles.confirm_delete_container}
                    >
                      <p>Are you Sure?</p>
                      <button
                        type="button"
                        onClick={() => setDeleteEpisodesClick(false)}
                      >
                        Cancel
                      </button>
                      <button onClick={() => deleteOptions("episodes")}>
                        Delete!
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>

                <label>
                  <motion.button
                    type="button"
                    onClick={() =>
                      setDeleteNotificationsClick(!deleteNotificationsClick)
                    }
                    variants={framerMotionBtnVariants}
                    whileTap="tap"
                    data-active={deleteNotificationsClick}
                  >
                    Delete Notifications
                  </motion.button>
                </label>
                <AnimatePresence initial={false} mode="wait">
                  {deleteNotificationsClick && (
                    <motion.div
                      initial={{
                        opacity: 0,
                        height: 0,
                        marginTop: "8px",
                        marginBottom: "40px",
                      }}
                      animate={{
                        opacity: 1,
                        height: "auto",
                        transition: { duration: 0.4 },
                      }}
                      exit={{
                        opacity: 0,
                        height: 0,
                        marginTop: "0",
                        marginBottom: "0",
                      }}
                      className={styles.confirm_delete_container}
                    >
                      <p>Are you Sure?</p>
                      <button
                        type="button"
                        onClick={() => setDeleteNotificationsClick(false)}
                      >
                        Cancel
                      </button>
                      <button onClick={() => deleteOptions("episodes")}>
                        Delete!
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>

                <label>
                  <motion.button
                    type="button"
                    onClick={() => setDeleteAccountClick(!deleteAccountClick)}
                    variants={framerMotionBtnVariants}
                    whileTap="tap"
                    data-active={deleteAccountClick}
                  >
                    Delete All Account Info
                  </motion.button>
                </label>
                <AnimatePresence initial={false} mode="wait">
                  {deleteAccountClick && (
                    <motion.div
                      initial={{
                        opacity: 0,
                        height: 0,
                        marginTop: "8px",
                        marginBottom: "40px",
                      }}
                      animate={{
                        opacity: 1,
                        height: "auto",
                        transition: { duration: 0.4 },
                      }}
                      exit={{
                        opacity: 0,
                        height: 0,
                        marginTop: "0",
                        marginBottom: "0",
                      }}
                      className={styles.confirm_delete_container}
                    >
                      <p>Are you Sure?</p>
                      <button
                        type="button"
                        onClick={() => setDeleteAccountClick(false)}
                      >
                        Cancel
                      </button>
                      <button onClick={() => deleteOptions("account")}>
                        Delete!
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          )}

          <motion.button
            whileTap={{ scale: 0.9 }}
            type="submit"
            data-change-success={wasSuccessfull}
            disabled={isLoading}
            title="Submit Changes"
          >
            {isLoading ? (
              <LoadingSvg width={21} height={21} />
            ) : wasSuccessfull == true ? (
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0 8px",
                }}
              >
                <CheckSvg width={16} height={16} /> Changes Complete
              </span>
            ) : (
              "Confirm Changes"
            )}
          </motion.button>
        </form>
      </motion.div>
    </motion.div>
  );
}

export default UserSettingsModal;
