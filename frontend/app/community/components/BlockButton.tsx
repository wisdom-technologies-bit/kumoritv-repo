"use client";
// Part C: Block / Unblock, in the actions row of a post or a comment.
//
// Signed-in only. Two steps (nothing blocks on one click), the state is read
// from the viewer's own list, and the blocked person is never told - the button
// only ever changes what THIS viewer sees.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchBlocked, setBlock } from "@/app/lib/community/blocks-client";
import styles from "../page.module.css";

type Props = {
  userId: string | null;
  name: string;
  isSignedIn: boolean;
  className?: string;
};

export default function BlockButton({ userId, name, isSignedIn, className }: Props) {
  const router = useRouter();
  const [blocked, setBlocked] = useState<boolean | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isSignedIn || !userId) return;
    let active = true;
    void fetchBlocked().then((people) => {
      if (active) setBlocked(people.some((person) => person.id === userId));
    });
    return () => {
      active = false;
    };
  }, [isSignedIn, userId]);

  if (!isSignedIn || !userId || blocked === null) return null;

  async function run(action: "block" | "unblock") {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const result = await setBlock(userId as string, action);
    setBusy(false);
    setConfirming(false);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setBlocked(action === "block");
    router.refresh();
  }

  return (
    <>
      {!confirming ? (
        <button
          type="button"
          className={className ?? styles.button_link}
          onClick={() => setConfirming(true)}
          disabled={busy}
        >
          {blocked ? "Unblock" : "Block"}
        </button>
      ) : (
        <span className={styles.confirm_row}>
          <span>
            {blocked
              ? `Unblock ${name}? Their posts and comments will show again.`
              : `Block ${name}? You will not see their posts, comments or replies, and they are not told.`}
          </span>
          <button
            type="button"
            className={className ?? styles.button_link}
            onClick={() => void run(blocked ? "unblock" : "block")}
            disabled={busy}
          >
            {busy ? "Saving…" : blocked ? "Yes, unblock" : "Yes, block"}
          </button>
          <button
            type="button"
            className={className ?? styles.button_link}
            onClick={() => setConfirming(false)}
            disabled={busy}
          >
            Cancel
          </button>
        </span>
      )}
      {message && (
        <span role="alert" className={styles.form_error}>
          {message}
        </span>
      )}
    </>
  );
}
