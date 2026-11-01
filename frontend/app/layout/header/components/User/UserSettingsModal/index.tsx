"use client";
import { AnimatePresence, motion } from "framer-motion";
import React, { MouseEventHandler, useCallback, useEffect, useRef, useState } from "react";
import styles from "./component.module.css";
import CloseSvg from "@/public/assets/x.svg";
import CheckSvg from "@/public/assets/check-circle-fill.svg";
import UserSvg from "@/public/assets/person-circle.svg";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/app/lib/supabase/browser";
import { useUser } from "@/app/lib/supabase/AuthProvider";
import * as contantOptions from "./contantOptions";
import anilistUsersActions from "@/app/api/anilist/anilistUsers";
import { getPrefs, setPref } from "@/app/lib/user-data/prefs";
import { clearFavourites } from "@/app/lib/user-data/favourites";
import { clearProgress } from "@/app/lib/user-data/progress";
import { clearNotifications } from "@/app/lib/user-data/notifications";
import { clearUserScopedCaches } from "@/app/lib/user-data/merge";
import SectionHeading from "./SectionHeading";
import SwitchRow from "./SwitchRow";
import NotificationsSection, { NOTIFICATIONS_SECTION_ID } from "./NotificationsSection";

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
  /** Scroll target when the modal is opened from `?settings=notifications`. */
  initialSection?: "notifications" | null;
};

type AudioPreference = "sub" | "dub";

// Everything the form can change. Columns that no part of the app reads
// (title_language, video_quality) and the legacy source / wrong-media-alert
// settings are intentionally absent: see the wiring audit in the PR notes.
type SettingsForm = {
  username: string;
  avatarUrl: string | null;
  subtitleLanguage: string;
  preferredAudio: AudioPreference;
  autoSkip: boolean;
  autoNext: boolean;
  showAdult: boolean;
};

type DeleteTarget = "favourites" | "history" | "notifications" | "account";

type SaveStatus = "idle" | "saving" | "saved" | "error";

const DELETE_COPY: Record<
  DeleteTarget,
  { title: string; body: string; action: string; done: string }
> = {
  favourites: {
    title: "Delete favourites?",
    body: "This removes every title you saved. This cannot be undone.",
    action: "Delete favourites",
    done: "Favourites deleted",
  },
  history: {
    title: "Delete watch history?",
    body: "This cannot be undone.",
    action: "Delete watch history",
    done: "Watch history deleted",
  },
  notifications: {
    title: "Delete notifications?",
    body: "This cannot be undone.",
    action: "Delete notifications",
    done: "Notifications deleted",
  },
  account: {
    title: "Delete account?",
    body: "Every saved title, watch history and notification is removed. This cannot be undone.",
    action: "Delete account",
    done: "Account deleted",
  },
};

const framerMotionDropIn = {
  hidden: {
    y: 24,
    opacity: 0,
  },
  visible: {
    y: 0,
    opacity: 1,
    transition: {
      duration: 0.2,
      damping: 25,
      type: "spring",
      stiffness: 500,
    },
  },
  exit: {
    y: 24,
    opacity: 0,
  },
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The cookie cleanup the old form did through anilistUserLoginOptions. */
async function clearSiteCookies() {
  const origin = process.env.NEXT_PUBLIC_WEBSITE_ORIGIN_URL || "";
  const routes = ["/api/media-title-language", "/api/subtitle", "/api/anilist"];

  for (const route of routes) {
    try {
      await fetch(`${origin}${route}`, { method: "DELETE" });
    } catch {
      /* cookies are best effort */
    }
  }
}

function UserSettingsModal({
  onClick,
  anilistUser,
  newUser,
  initialSection = null,
}: SettingsTypes) {
  const { user: supabaseUser, profile } = useUser();
  const router = useRouter();
  const client = createBrowserSupabaseClient();

  const modalRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const [initial, setInitial] = useState<SettingsForm | null>(null);
  const [form, setForm] = useState<SettingsForm | null>(null);

  const [openUserProfilePanel, setOpenUserProfilePanel] = useState<boolean>(false);
  const [pendingDelete, setPendingDelete] = useState<DeleteTarget | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState<string>("");

  const [status, setStatus] = useState<SaveStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");

  const isSignedIn = Boolean(supabaseUser);
  const isAnonymous = supabaseUser?.is_anonymous ?? false;
  const canEditProfile = isSignedIn;

  // Load once: prefs (profiles for signed-in users, localStorage for guests) plus
  // the adult content flag the server owns.
  useEffect(() => {
    let active = true;

    async function load() {
      const prefs = await getPrefs();

      let showAdult = false;

      try {
        const response = await fetch("/api/adult-content", { cache: "no-store" });

        if (response.ok) {
          const state = await response.json();
          showAdult = state?.show === true;
        }
      } catch {
        showAdult = false;
      }

      if (!active) return;

      const next: SettingsForm = {
        username:
          profile?.username ||
          profile?.display_name ||
          (supabaseUser?.user_metadata?.username as string) ||
          "",
        avatarUrl: profile?.avatar_url || null,
        subtitleLanguage: prefs.subtitle_language || "English",
        preferredAudio: prefs.dubEpisodes ? "dub" : "sub",
        autoSkip: Boolean(prefs.autoSkip),
        autoNext: Boolean(prefs.autoNext),
        showAdult,
      };

      setForm(next);
      setInitial(next);
    }

    void load();

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeModal = useCallback(() => {
    if (newUser) return;

    (onClick as MouseEventHandler<HTMLDivElement>)?.(
      undefined as unknown as React.MouseEvent<HTMLDivElement>
    );
  }, [newUser, onClick]);

  // Focus lands inside the dialog, Tab is trapped, Escape closes, and the element
  // that opened the modal gets focus back.
  useEffect(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;

    const node = modalRef.current;
    const firstField = node?.querySelector<HTMLElement>(FOCUSABLE);
    firstField?.focus?.();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();

        setPendingDelete((current) => {
          if (current) return null;

          closeModal();

          return null;
        });

        return;
      }

      if (event.key !== "Tab" || !node) return;

      const focusables = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));

      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const activeElement = document.activeElement;

      if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);

      restoreFocusRef.current?.focus?.();
    };
  }, [closeModal]);

  // `?settings=notifications` scrolls the Notifications card into view. jsdom has
  // no scrollIntoView, hence the optional call.
  useEffect(() => {
    if (initialSection !== "notifications") return;

    const node = document.getElementById(NOTIFICATIONS_SECTION_ID);
    node?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }, [initialSection]);

  const update = useCallback(<K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) => {
    setForm((current) => (current ? { ...current, [key]: value } : current));
    setStatus("idle");
    setErrorMessage("");
  }, []);

  const isDirty = Boolean(
    form && initial && JSON.stringify(form) !== JSON.stringify(initial)
  );

  async function handleUpdateUserInfoForm(
    event: React.FormEvent<HTMLFormElement> | HTMLFormElement
  ) {
    event.preventDefault();

    if (!form || !initial || status === "saving") return;

    setStatus("saving");
    setErrorMessage("");

    try {
      if (supabaseUser && client) {
        // Only the columns this form owns are written. `preferred_audio` is set
        // through setPref below (sub/dub), never from a legacy source name.
        const patch: Record<string, unknown> = {
          avatar_url: form.avatarUrl || profile?.avatar_url || null,
        };

        if (!isAnonymous) {
          const username = form.username.trim().slice(0, 40);

          if (username) {
            patch.username = username;
            patch.display_name = username;
          }
        }

        const { error } = await (client as any)
          .from("profiles")
          .update(patch)
          .eq("id", supabaseUser.id);

        if (error) throw error;
      }

      // Playback preferences: profiles table when signed in, localStorage for guests.
      await setPref("subtitle_language", form.subtitleLanguage);
      await setPref("autoSkip", form.autoSkip);
      await setPref("autoNext", form.autoNext);
      await setPref("dubEpisodes", form.preferredAudio === "dub");

      const adultResponse = await fetch("/api/adult-content", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: form.showAdult === true }),
      });

      if (!adultResponse.ok) throw new Error("adult content preference not saved");

      if (anilistUser) {
        await anilistUsersActions.handleAdultContentSetting({
          isEnabled: `${form.showAdult}`,
        });

        await anilistUsersActions.handleSubtitleLanguageSetting({
          lang: form.subtitleLanguage,
        });
      }

      router.refresh();

      setInitial({ ...form });
      setStatus("saved");
    } catch {
      setStatus("error");
      setErrorMessage("We could not save your changes. Please try again.");
    }
  }

  async function runDelete(target: DeleteTarget) {
    setPendingDelete(null);
    setErrorMessage("");

    try {
      switch (target) {
        case "favourites":
          await clearFavourites();
          break;

        case "history":
          await clearProgress();
          break;

        case "notifications":
          await clearNotifications();
          break;

        case "account":
          if (supabaseUser) {
            const response = await fetch("/api/account/delete", { method: "POST" });

            if (!response.ok) throw new Error("Unable to delete account");

            await client?.auth.signOut();
          } else {
            clearUserScopedCaches();
            await clearSiteCookies();
          }

          window.location.href = "/";
          return;

        default:
          return;
      }

      setStatus("idle");
      setErrorMessage(DELETE_COPY[target].done);
    } catch {
      setErrorMessage("That could not be deleted. Please try again.");
    } finally {
      setDeleteConfirmText("");
    }
  }

  const avatarSrc =
    form?.avatarUrl || profile?.avatar_url || anilistUser?.avatar?.large || null;

  const confirmCopy = pendingDelete ? DELETE_COPY[pendingDelete] : null;
  const accountDeleteReady = deleteConfirmText.trim().toUpperCase() === "DELETE";

  return (
    <motion.div
      id={styles.backdrop}
      onClick={!newUser ? closeModal : undefined}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        onClick={(event) => event.stopPropagation()}
        id={styles.modal}
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        variants={framerMotionDropIn}
        initial="hidden"
        animate="visible"
        exit="exit"
      >
        <div className={styles.settings_heading}>
          <h2 id="settings-modal-title">Settings</h2>

          {!newUser && (
            <button
              type="button"
              title="Close settings"
              aria-label="Close settings"
              onClick={() => closeModal()}
              id={styles.close_menu_btn}
            >
              <CloseSvg alt="Close" width={16} height={16} />
            </button>
          )}
        </div>

        <form className={styles.settings_form} onSubmit={handleUpdateUserInfoForm}>
          <div className={styles.body}>
            {isAnonymous && (
              <div className={styles.note}>
                <b>Anonymous mode.</b> You can change playback preferences, but not
                your username or comments.
              </div>
            )}

            {/* PROFILE */}
            <section className={styles.card}>
              <SectionHeading
                title="Profile"
                description={
                  canEditProfile
                    ? "How you appear on comments and lists."
                    : "Your profile is managed on AniList."
                }
              />

              {canEditProfile ? (
                <div className={styles.profile_row}>
                  <div className={styles.avatar} data-avatar-container="true">
                    {avatarSrc ? (
                      <Image
                        src={avatarSrc}
                        alt="Profile picture"
                        fill
                        sizes="96px"
                      />
                    ) : (
                      <span className={styles.avatar_fallback} aria-hidden="true">
                        <UserSvg width={36} height={36} />
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    className={styles.secondary_btn}
                    onClick={() => setOpenUserProfilePanel((open) => !open)}
                    aria-expanded={openUserProfilePanel}
                  >
                    Change avatar
                  </button>
                </div>
              ) : (
                anilistUser && (
                  <a
                    className={styles.link}
                    href={`https://anilist.co/user/${anilistUser.name}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open your AniList profile
                  </a>
                )
              )}

              <AnimatePresence initial={false} mode="wait">
                {canEditProfile && openUserProfilePanel && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className={styles.imgs_panel_container}
                  >
                    {contantOptions.imagesOptions.map((item, key) => (
                      <div key={`${item.value}-${key}`} className={styles.img_checkbox}>
                        <input
                          type="checkbox"
                          name="photoURL"
                          aria-label={`Use ${item.name} as avatar`}
                          value={item.value}
                          checked={form?.avatarUrl === item.value}
                          onChange={() =>
                            update(
                              "avatarUrl",
                              form?.avatarUrl === item.value ? null : item.value
                            )
                          }
                        />
                        <Image src={item.value} alt="" fill sizes="96px" />
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              {canEditProfile && (
                <div className={styles.field}>
                  <label htmlFor="settings-username">Username</label>
                  <input
                    id="settings-username"
                    type="text"
                    name="username"
                    maxLength={40}
                    autoComplete="off"
                    disabled={isAnonymous}
                    value={form?.username ?? ""}
                    placeholder="Your username"
                    onChange={(event) => update("username", event.target.value)}
                  />
                  {isAnonymous && (
                    <span className={styles.helper}>
                      Username cannot be changed while Anonymous.
                    </span>
                  )}
                </div>
              )}
            </section>

            {/* PLAYBACK */}
            <section className={styles.card}>
              <SectionHeading
                title="Playback"
                description="Defaults used by the watch page and the player."
              />

              <div className={styles.field}>
                <label htmlFor="settings-subtitle-language">Subtitle language</label>
                <select
                  id="settings-subtitle-language"
                  name="subtitleLanguage"
                  value={form?.subtitleLanguage || "English"}
                  onChange={(event) => update("subtitleLanguage", event.target.value)}
                  disabled={!form}
                >
                  {contantOptions.languagesOptions.map((language) => (
                    <option key={language.value} value={language.value}>
                      {language.name}
                    </option>
                  ))}
                </select>
                <span className={styles.helper}>
                  Used when the stream offers this language.
                </span>
              </div>

              <div className={styles.field}>
                <span className={styles.field_label}>Preferred audio</span>
                <div
                  className={styles.segmented}
                  role="group"
                  aria-label="Preferred audio"
                >
                  {[
                    { label: "Sub", value: "sub" as AudioPreference },
                    { label: "Dub", value: "dub" as AudioPreference },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      data-audio={option.value}
                      data-active={form?.preferredAudio === option.value}
                      aria-pressed={form?.preferredAudio === option.value}
                      onClick={() => update("preferredAudio", option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <span className={styles.helper}>
                  Which audio track the watch page picks when both are available.
                </span>
              </div>

              <SwitchRow
                id="settings-auto-skip"
                name="autoSkip"
                label="Skip intro & outro"
                description="Jump past openings and endings."
                checked={form?.autoSkip === true}
                onChange={(value) => update("autoSkip", value)}
              />

              <SwitchRow
                id="settings-auto-next"
                name="autoNext"
                label="Autoplay next episode"
                description="Start the next episode when this one ends."
                checked={form?.autoNext === true}
                onChange={(value) => update("autoNext", value)}
              />
            </section>

            {/* CONTENT */}
            <section className={styles.card}>
              <SectionHeading
                title="Content"
                description="What shows up in search and browse."
              />

              <SwitchRow
                id="settings-show-adult"
                name="showAdultContent"
                label="Show adult content (18+)"
                checked={form?.showAdult === true}
                onChange={(value) => update("showAdult", value)}
              />

              {anilistUser && (
                <span className={styles.helper}>
                  This also updates your AniList account setting.
                </span>
              )}
            </section>

            {/* NOTIFICATIONS */}
            <NotificationsSection isSignedIn={isSignedIn} />

            {/* DATA */}
            <section className={styles.card}>
              <SectionHeading
                title="Data"
                description="Clear what this account has stored."
              />

              <div className={styles.data_list}>
                <button
                  type="button"
                  className={styles.danger_btn}
                  onClick={() => setPendingDelete("favourites")}
                  disabled={!isSignedIn && !anilistUser}
                >
                  Delete favourites
                </button>

                <button
                  type="button"
                  className={styles.danger_btn}
                  onClick={() => setPendingDelete("history")}
                  disabled={!isSignedIn && !anilistUser}
                >
                  Delete watch history
                </button>

                <button
                  type="button"
                  className={styles.danger_btn}
                  onClick={() => setPendingDelete("notifications")}
                  disabled={!isSignedIn && !anilistUser}
                >
                  Delete notifications
                </button>

                <button
                  type="button"
                  className={styles.danger_btn}
                  onClick={() => setPendingDelete("account")}
                  disabled={!isSignedIn && !anilistUser}
                >
                  Delete account
                </button>
              </div>
            </section>
          </div>

          {/* STICKY FOOTER: the save button never covers the last field. */}
          <div className={styles.footer}>
            <AnimatePresence initial={false} mode="wait">
              {status === "saved" && (
                <motion.p
                  key="saved"
                  role="status"
                  className={styles.saved_message}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <CheckSvg width={14} height={14} alt="" /> Saved
                </motion.p>
              )}

              {status === "error" && errorMessage && (
                <motion.p
                  key="error"
                  role="alert"
                  className={styles.error_message}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  {errorMessage}
                </motion.p>
              )}
            </AnimatePresence>

            {status !== "error" && status !== "saved" && errorMessage && (
              <p role="status" className={styles.saved_message}>
                {errorMessage}
              </p>
            )}

            <button
              type="submit"
              className={styles.save_btn}
              disabled={!isDirty || status === "saving" || !form}
              data-state={status}
            >
              {status === "saving"
                ? "Saving…"
                : status === "saved"
                  ? "Saved"
                  : "Save changes"}
            </button>
          </div>
        </form>

        {pendingDelete && confirmCopy && (
          <div
            className={styles.confirm_backdrop}
            onClick={() => {
              setPendingDelete(null);
              setDeleteConfirmText("");
            }}
          >
            <div
              className={styles.confirm_dialog}
              role="dialog"
              aria-modal="true"
              aria-label={confirmCopy.title}
              onClick={(event) => event.stopPropagation()}
            >
              <h3>{confirmCopy.title}</h3>
              <p>{confirmCopy.body}</p>

              {pendingDelete === "account" && (
                <div className={styles.field}>
                  <label htmlFor="settings-delete-confirm">
                    Type DELETE to confirm
                  </label>
                  <input
                    id="settings-delete-confirm"
                    type="text"
                    name="deleteAccountConfirm"
                    autoComplete="off"
                    value={deleteConfirmText}
                    onChange={(event) => setDeleteConfirmText(event.target.value)}
                  />
                </div>
              )}

              <div className={styles.confirm_actions}>
                <button
                  type="button"
                  className={styles.secondary_btn}
                  onClick={() => {
                    setPendingDelete(null);
                    setDeleteConfirmText("");
                  }}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  className={styles.danger_btn}
                  onClick={() => runDelete(pendingDelete)}
                  disabled={pendingDelete === "account" && !accountDeleteReady}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

export default UserSettingsModal;
