"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "../page.module.css";
import ReportDialog from "./ReportDialog";
import { FlagIcon, ShareIcon, TrashIcon } from "./icons";
import { useCopyLink } from "./shared";

type ThreadActionsProps = {
  kind: "post" | "announcement";
  id: string;
  url: string;
  canDelete?: boolean;
};

/** Share / report / delete on a thread page. Delete redirects home on success. */
export default function ThreadActions({ kind, id, url, canDelete = false }: ThreadActionsProps) {
  const router = useRouter();
  const { copied, copy } = useCopyLink();
  const [isReporting, setIsReporting] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function remove() {
    setIsConfirming(false);
    try {
      const response = await fetch(`/api/community/posts/${id}`, { method: "DELETE" });
      if (!response.ok) {
        setMessage("We could not delete that post.");
        return;
      }
      router.push("/community");
      router.refresh();
    } catch {
      setMessage("We could not delete that post.");
    }
  }

  return (
    <div className={styles.post_actions}>
      <button type="button" className={styles.button_link} onClick={() => void copy(url)}>
        <ShareIcon />
        {copied ? "Copied" : "Share"}
      </button>

      <button type="button" className={styles.button_link} onClick={() => setIsReporting(true)}>
        <FlagIcon />
        Report
      </button>

      {canDelete && kind === "post" && (
        <div className={styles.post_actions_end}>
          {isConfirming ? (
            <span className={styles.confirm_row}>
              Delete?
              <button type="button" className={styles.button_link} onClick={() => void remove()}>
                Yes
              </button>
              <button type="button" className={styles.button_link} onClick={() => setIsConfirming(false)}>
                No
              </button>
            </span>
          ) : (
            <button type="button" className={styles.button_link} onClick={() => setIsConfirming(true)}>
              <TrashIcon />
              Delete
            </button>
          )}
        </div>
      )}

      {message && (
        <p className={styles.errors} role="alert">
          {message}
        </p>
      )}

      {isReporting && <ReportDialog targetKind={kind} targetId={id} onClose={() => setIsReporting(false)} />}
    </div>
  );
}
