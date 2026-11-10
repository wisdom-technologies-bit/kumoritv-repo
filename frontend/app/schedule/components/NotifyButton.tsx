"use client";
// "Notify me" reuses the notification layer the rest of the site uses:
// `subscribe` / `unsubscribe` / `isSubscribed` from app/lib/user-data, and the
// same sign-in modal every other guarded action dispatches.
import { useEffect, useState } from "react";
import styles from "../schedule.module.css";
import { useUser } from "@/app/lib/supabase/AuthProvider";
import { useAppDispatch, useAppSelector } from "@/app/lib/redux/hooks";
import { toggleShowLoginModalValue } from "@/app/lib/redux/features/loginModal";
import { isSubscribed, subscribe, unsubscribe } from "@/app/lib/user-data/notifications";
import { scheduleTitle } from "@/app/lib/schedule/format";
import type { ScheduleMedia } from "@/app/lib/schedule/types";

export default function NotifyButton({ media }: { media: ScheduleMedia }) {
  const { user, loading } = useUser();
  const anilistUser = useAppSelector((state) => state.UserInfo.value);
  const dispatch = useAppDispatch();
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    if (loading || !user) {
      setSubscribed(false);
      return () => {
        alive = false;
      };
    }
    void isSubscribed(media.id)
      .then((value) => {
        if (alive) setSubscribed(value);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [user, loading, media.id]);

  async function handleClick() {
    if (!user && !anilistUser) {
      dispatch(toggleShowLoginModalValue());
      return;
    }
    setBusy(true);
    const before = subscribed;
    setSubscribed(!before);
    const ok = before
      ? await unsubscribe(media.id)
      : await subscribe({
          id: media.id,
          title: media.title,
          format: media.format,
          description: undefined,
          coverImage: media.coverImage ?? undefined,
        });
    if (!ok) setSubscribed(before);
    setBusy(false);
  }

  return (
    <button
      type="button"
      className={styles.action}
      data-active={subscribed}
      aria-pressed={subscribed}
      disabled={busy}
      onClick={handleClick}
      title={
        subscribed
          ? `Stop notifying me about ${scheduleTitle(media)}`
          : `Notify me when ${scheduleTitle(media)} gets a new episode`
      }
    >
      {subscribed ? "Notifying" : "Notify me"}
    </button>
  );
}
