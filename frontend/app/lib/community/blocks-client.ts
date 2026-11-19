"use client";
// The viewer's block list, from the browser.
//
// One place so the block button, the settings list and the new-post toast cannot
// disagree. Everything goes through /api/community/blocks, which checks the
// session and refuses to block staff.
export type BlockedPerson = { id: string; name: string };

export async function fetchBlocked(): Promise<BlockedPerson[]> {
  try {
    const response = await fetch("/api/community/blocks", { cache: "no-store" });
    if (!response.ok) return [];
    const body = (await response.json()) as { blocked?: BlockedPerson[] };
    return Array.isArray(body.blocked) ? body.blocked : [];
  } catch {
    return [];
  }
}

export async function setBlock(userId: string, action: "block" | "unblock"): Promise<
  { ok: true } | { ok: false; message: string }
> {
  try {
    const response = await fetch("/api/community/blocks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, action }),
    });
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    if (!response.ok) {
      return { ok: false, message: body.message ?? "That did not save. Try again." };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: "That did not save. Check your connection." };
  }
}
