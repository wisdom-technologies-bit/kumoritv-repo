// Prompt 35: who is asking, on the server.
//
// The session comes from the existing Supabase server client (cookies); the IP
// only ever exists inside a rate-limit key and a salted hash. No client-supplied
// user id is ever read from a body.

import "server-only";
import { cookies } from "next/headers";
import { createClient } from "@/app/lib/supabase/server";
import { CLIP_OWNER_COOKIE } from "./constants";

export type ClipViewer = { userId: string | null };

/** A signed-in session id, or null for a guest. Never throws. */
export async function readClipViewer(): Promise<ClipViewer> {
  try {
    const client: any = createClient();
    if (!client) return { userId: null };
    const { data } = await client.auth.getUser();
    const id = data?.user?.id;
    return { userId: typeof id === "string" && id ? id : null };
  } catch {
    return { userId: null };
  }
}

/** The first hop of x-forwarded-for, or "unknown". */
export function clientIp(request: Request): string {
  const header = request.headers.get("x-forwarded-for") || "";
  return header.split(",")[0].trim() || "unknown";
}

/** The guest's ownership token, when they have one. */
export function readOwnerCookie(): string | null {
  try {
    const value = cookies().get(CLIP_OWNER_COOKIE)?.value;
    return typeof value === "string" && value.length >= 16 ? value : null;
  } catch {
    return null;
  }
}
