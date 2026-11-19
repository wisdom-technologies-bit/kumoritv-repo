"use client";
// Part C: the Blocked users list, in Settings.
//
// Reads the viewer's own list from /api/community/blocks (the same route the
// Block button uses) and unblocks in place. Nothing here tells the blocked
// person anything.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchBlocked, setBlock, type BlockedPerson } from "@/app/lib/community/blocks-client";

export default function BlockedUsersSection({ className }: { className?: string }) {
  const router = useRouter();
  const [people, setPeople] = useState<BlockedPerson[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetchBlocked().then((list) => {
      if (active) setPeople(list);
    });
    return () => {
      active = false;
    };
  }, []);

  async function unblock(id: string) {
    if (busy) return;
    setBusy(id);
    setError(null);
    const result = await setBlock(id, "unblock");
    setBusy(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setPeople((current) => (current ?? []).filter((person) => person.id !== id));
    router.refresh();
  }

  return (
    <section className={className}>
      <h3>Blocked users</h3>
      <p>
        People you block are hidden from your feed and from comment threads, and they cannot reach you with replies,
        mentions or likes. They are never told.
      </p>
      {people === null ? (
        <p>Loading…</p>
      ) : people.length === 0 ? (
        <p>You have not blocked anyone.</p>
      ) : (
        <ul>
          {people.map((person) => (
            <li key={person.id}>
              {person.name}{" "}
              <button type="button" onClick={() => void unblock(person.id)} disabled={busy === person.id}>
                {busy === person.id ? "Unblocking…" : "Unblock"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" style={{ color: "#ff9db4" }}>
          {error}
        </p>
      )}
    </section>
  );
}
