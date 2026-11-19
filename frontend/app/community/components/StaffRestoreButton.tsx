"use client";
// A staff-only Restore, in context.
//
// Deliberately tiny: the admin area is code-split and never shipped to a normal
// visitor, so this cannot import from /community/admin. It only appears when the
// row the server sent has a non-published status, which only staff and the
// author ever receive (RLS decides), and the route re-checks the role anyway.
import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../page.module.css";

export default function StaffRestoreButton({ kind, id }: { kind: string; id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function restore() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/community/admin/moderate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, id, action: "restore" }),
      });
      if (!response.ok) {
        setError("Could not restore.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not restore.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span>
      <button type="button" className={styles.moderation_link} onClick={restore} disabled={busy}>
        {busy ? "Restoring…" : "Restore"}
      </button>
      {error && <span role="alert"> {error}</span>}
    </span>
  );
}
