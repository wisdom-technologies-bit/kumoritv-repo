"use client";
// Resolves "who is signed in" and gives every module the same safe-call plumbing.
//
// A user only counts as signed in when a Supabase session exists. An AniList-only
// user (Redux anilistUser with no Supabase session) is treated as a guest.

import { createBrowserSupabaseClient } from "@/app/lib/supabase/browser";

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/** Supabase client is untyped here on purpose: the generated Database type only
 *  describes a subset of the tables this layer reads (notifications, ...). */
export type SupabaseLike = {
  from(table: string): any;
  /** Used for the security-definer helpers (`push_allowed`, `claim_push_outbox`). */
  rpc?(fn: string, args?: Record<string, unknown>): any;
  auth?: any;
};

export type UserDataContext = {
  userId: string | null;
  client: SupabaseLike | null;
  storage: StorageLike | null;
  now: () => number;
};

export type UserDataContextInput = Partial<UserDataContext>;

export function defaultStorage(): StorageLike | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

let sessionUserId: string | null = null;
let sessionResolved = false;
let sessionPending: Promise<string | null> | null = null;
let authSubscribed = false;

async function resolveSessionUserId(client: SupabaseLike & { auth: any }): Promise<string | null> {
  if (sessionResolved) return sessionUserId;

  if (!sessionPending) {
    sessionPending = (async () => {
      try {
        const { data } = await client.auth.getSession();
        sessionUserId = data?.session?.user?.id ?? null;
      } catch {
        sessionUserId = null;
      }
      sessionResolved = true;
      return sessionUserId;
    })();

    if (!authSubscribed) {
      authSubscribed = true;
      try {
        client.auth.onAuthStateChange((_event: string, session: any) => {
          sessionUserId = session?.user?.id ?? null;
          sessionResolved = true;
          sessionPending = null;
        });
      } catch {
        /* auth listener is optional */
      }
    }
  }

  return sessionPending;
}

let defaultContextOverride: UserDataContext | null = null;

/** Test seam: lets the suite present a fake signed-in/guest context. */
export function __setDefaultContextForTests(context: UserDataContext | null): void {
  defaultContextOverride = context;
}

export async function getDefaultContext(): Promise<UserDataContext> {
  if (defaultContextOverride) return defaultContextOverride;
  const client = createBrowserSupabaseClient() as unknown as (SupabaseLike & { auth: any }) | null;
  const userId = client ? await resolveSessionUserId(client) : null;
  return { userId, client, storage: defaultStorage(), now: () => Date.now() };
}

export async function resolveContext(input?: UserDataContextInput): Promise<UserDataContext> {
  if (!input) return getDefaultContext();
  return {
    userId: input.userId ?? null,
    client: input.client ?? null,
    storage: input.storage ?? defaultStorage(),
    now: input.now ?? (() => Date.now()),
  };
}

export function clearSessionCache(): void {
  sessionUserId = null;
  sessionResolved = false;
  sessionPending = null;
}

export type Attempt<T> = { ok: true; data: T } | { ok: false; error: unknown };

/** Runs a Supabase call. A failure is logged as a warning and reported back so the
 *  caller can fall back to its local copy. It never rejects. */
export async function attempt<T>(label: string, run: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    try {
      console.warn(
        `[user-data] ${label} failed, using local copy`,
        error instanceof Error ? error.message : error,
      );
    } catch {
      /* console may be unavailable */
    }
    return { ok: false, error };
  }
}

export function unwrap<T>(result: { data: T | null | undefined; error: unknown }): T {
  if (result.error) throw result.error;
  return result.data as T;
}

export function isSignedIn(ctx: UserDataContext): boolean {
  return Boolean(ctx.userId && ctx.client);
}
