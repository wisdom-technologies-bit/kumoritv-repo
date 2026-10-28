"use client";
// Chapters read: localStorage for guests, Supabase `chapters_read` for signed-in
// users (row level security keeps every row to its own owner).
// Every call is wrapped: a missing table or a failed request falls back to the
// local copy and never throws.

import { attempt, isSignedIn, resolveContext, type UserDataContextInput } from "./context";
import { readJson, writeJson } from "./storage";

export const GUEST_CHAPTERS_KEY = "kumori_chapters_v1";
/** The key Prompt 9's local-only button used; migrated once, then dropped. */
export const LEGACY_GUEST_CHAPTERS_KEY = "kumori_chapters_read_v1";
export const CHAPTERS_CHANGE_EVENT = "kumori-chapters-change";
export const LAST_PAGE_WRITE_INTERVAL_MS = 15_000;

export type ChapterRecord = {
  anilistId: number;
  chapterNumber: number;
  chapterId?: string | null;
  lastPage?: number | null;
  snapshot?: unknown;
  readAt: number;
};

type ChapterStore = Record<string, Record<string, ChapterRecord>>;

export type MarkReadOptions = {
  chapterId?: string | null;
  page?: number | null;
  snapshot?: unknown;
};

export function chaptersCacheKey(userId: string): string {
  return `kumori_chapters_cache_${userId}`;
}

function localKey(ctx: { userId: string | null; client: unknown }): string {
  return ctx.userId && ctx.client ? chaptersCacheKey(ctx.userId) : GUEST_CHAPTERS_KEY;
}

function isRecord(value: unknown): value is ChapterRecord {
  const record = value as ChapterRecord | null;
  return Boolean(record && Number.isFinite(Number(record.anilistId)) && Number.isFinite(Number(record.chapterNumber)));
}

function readStore(store: ChapterStore | unknown): ChapterStore {
  if (!store || typeof store !== "object") return {};
  const cleaned: ChapterStore = {};
  for (const [mediaId, chapters] of Object.entries(store as Record<string, unknown>)) {
    if (!chapters || typeof chapters !== "object") continue;
    for (const [chapterNumber, record] of Object.entries(chapters as Record<string, unknown>)) {
      if (!isRecord(record)) continue;
      cleaned[mediaId] ??= {};
      cleaned[mediaId][chapterNumber] = record;
    }
  }
  return cleaned;
}

function emitChange() {
  try {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(CHAPTERS_CHANGE_EVENT));
  } catch {
    /* no window: nothing to notify */
  }
}

/** Prompt 9 wrote `{ [mediaId]: ChapterRecord[] }` under another key. */
function migrateLegacyGuestStore(storage: { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void } | null): void {
  if (!storage) return;
  try {
    if (storage.getItem(GUEST_CHAPTERS_KEY)) return;
    const legacy = readJson<unknown>(storage, LEGACY_GUEST_CHAPTERS_KEY, null);
    if (!legacy || typeof legacy !== "object") return;

    const migrated: ChapterStore = {};
    for (const [mediaId, list] of Object.entries(legacy as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        const record = item as { mediaId?: number; chapterNumber?: number; chapterTitle?: string };
        const anilistId = Number(record?.mediaId ?? mediaId);
        const chapterNumber = Number(record?.chapterNumber);
        if (!Number.isFinite(anilistId) || !Number.isFinite(chapterNumber)) continue;
        migrated[String(anilistId)] ??= {};
        migrated[String(anilistId)][String(chapterNumber)] = {
          anilistId,
          chapterNumber,
          snapshot: record?.chapterTitle ? { title: record.chapterTitle } : null,
          readAt: Date.now(),
        };
      }
    }

    if (Object.keys(migrated).length > 0) writeJson(storage, GUEST_CHAPTERS_KEY, migrated);
    storage.removeItem(LEGACY_GUEST_CHAPTERS_KEY);
  } catch {
    /* migration is a nicety */
  }
}

function localRecords(ctx: { storage: unknown; userId: string | null; client: unknown }, anilistId: number): ChapterRecord[] {
  const storage = ctx.storage as { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void } | null;
  migrateLegacyGuestStore(storage);
  const store = readStore(readJson<ChapterStore>(storage, localKey(ctx), {}));
  return Object.values(store[String(anilistId)] ?? {});
}

function writeLocal(ctx: { storage: unknown; userId: string | null; client: unknown }, anilistId: number, records: ChapterRecord[]): ChapterStore {
  const storage = ctx.storage as { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void } | null;
  const store = readStore(readJson<ChapterStore>(storage, localKey(ctx), {}));
  store[String(anilistId)] = Object.fromEntries(records.map((record) => [String(record.chapterNumber), record]));
  writeJson(storage, localKey(ctx), store);
  return store;
}

function toRecord(row: Record<string, unknown>): ChapterRecord | null {
  const anilistId = Number(row.anilist_id);
  const chapterNumber = Number(row.chapter_number);
  if (!Number.isFinite(anilistId) || !Number.isFinite(chapterNumber)) return null;
  return {
    anilistId,
    chapterNumber,
    chapterId: (row.chapter_id as string | null) ?? null,
    lastPage: row.last_page == null ? null : Number(row.last_page),
    snapshot: row.snapshot ?? null,
    readAt: Date.parse(String(row.read_at ?? "")) || Date.now(),
  };
}

/** Every chapter of a title this user has read, newest first. */
export async function listRead(anilistId: number, input?: UserDataContextInput): Promise<ChapterRecord[]> {
  const ctx = await resolveContext(input);
  const local = localRecords(ctx, anilistId);

  if (!isSignedIn(ctx)) return local.sort((a, b) => b.readAt - a.readAt);

  const result = await attempt("chapters.list", async () => {
    const { data, error } = await ctx.client!.from("chapters_read")
      .select("anilist_id, chapter_number, chapter_id, last_page, snapshot, read_at")
      .eq("user_id", ctx.userId)
      .eq("anilist_id", Number(anilistId))
      .order("read_at", { ascending: false });
    if (error) throw error;
    return ((data ?? []) as Record<string, unknown>[]).map(toRecord).filter((record): record is ChapterRecord => Boolean(record));
  });

  if (!result.ok) return local.sort((a, b) => b.readAt - a.readAt);

  writeLocal(ctx, anilistId, result.data);
  return result.data.sort((a, b) => b.readAt - a.readAt);
}

export async function isRead(anilistId: number, chapterNumber: number, input?: UserDataContextInput): Promise<boolean> {
  const records = await listRead(anilistId, input);
  return records.some((record) => Number(record.chapterNumber) === Number(chapterNumber));
}

export async function markRead(
  anilistId: number,
  chapterNumber: number,
  options: MarkReadOptions = {},
  input?: UserDataContextInput,
): Promise<boolean> {
  const number = Number(chapterNumber);
  if (!Number.isFinite(Number(anilistId)) || !Number.isFinite(number)) return false;

  const ctx = await resolveContext(input);
  const before = localRecords(ctx, anilistId);
  const record: ChapterRecord = {
    anilistId: Number(anilistId),
    chapterNumber: number,
    chapterId: options.chapterId ?? null,
    lastPage: options.page ?? null,
    snapshot: options.snapshot ?? null,
    readAt: ctx.now(),
  };

  // Optimistic: the UI is already showing this as read.
  writeLocal(ctx, anilistId, [...before.filter((item) => Number(item.chapterNumber) !== number), record]);
  emitChange();

  if (!isSignedIn(ctx)) return true;

  const result = await attempt("chapters.markRead", async () => {
    const { error } = await ctx.client!.from("chapters_read").upsert(
      {
        user_id: ctx.userId,
        anilist_id: record.anilistId,
        chapter_number: number,
        chapter_id: record.chapterId,
        last_page: record.lastPage,
        snapshot: record.snapshot,
        read_at: new Date(record.readAt).toISOString(),
      },
      { onConflict: "user_id,anilist_id,chapter_number" },
    );
    if (error) throw error;
    return true;
  });

  if (!result.ok) {
    // Roll the optimistic write back so local and server stay in step.
    writeLocal(ctx, anilistId, before);
    emitChange();
    return false;
  }

  return true;
}

export async function unmarkRead(
  anilistId: number,
  chapterNumber: number,
  input?: UserDataContextInput,
): Promise<boolean> {
  const number = Number(chapterNumber);
  const ctx = await resolveContext(input);
  const before = localRecords(ctx, anilistId);

  writeLocal(ctx, anilistId, before.filter((item) => Number(item.chapterNumber) !== number));
  emitChange();

  if (!isSignedIn(ctx)) return true;

  const result = await attempt("chapters.unmarkRead", async () => {
    const { error } = await ctx.client!.from("chapters_read")
      .delete()
      .eq("user_id", ctx.userId)
      .eq("anilist_id", Number(anilistId))
      .eq("chapter_number", number);
    if (error) throw error;
    return true;
  });

  if (!result.ok) {
    writeLocal(ctx, anilistId, before);
    emitChange();
    return false;
  }

  return true;
}

// ------------------------------------------------------------ last page read

const lastWriteAt = new Map<string, number>();
const pendingLastPage = new Map<string, { anilistId: number; chapterNumber: number; page: number }>();
let flushListenersInstalled = false;

function pageKey(anilistId: number, chapterNumber: number): string {
  return `${anilistId}:${chapterNumber}`;
}

function installFlushListeners() {
  if (flushListenersInstalled) return;
  if (typeof window === "undefined") return;
  flushListenersInstalled = true;
  try {
    window.addEventListener("pagehide", () => void flushLastPage());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") void flushLastPage();
    });
  } catch {
    /* listeners are a nicety */
  }
}

async function writeLastPage(anilistId: number, chapterNumber: number, page: number): Promise<void> {
  const ctx = await resolveContext();
  if (!isSignedIn(ctx)) return;

  const result = await attempt("chapters.saveLastPage", async () => {
    const { error } = await ctx.client!.from("chapters_read").upsert(
      {
        user_id: ctx.userId,
        anilist_id: Number(anilistId),
        chapter_number: Number(chapterNumber),
        last_page: Number(page),
        read_at: new Date(ctx.now()).toISOString(),
      },
      { onConflict: "user_id,anilist_id,chapter_number" },
    );
    if (error) throw error;
    return true;
  });

  if (result.ok) lastWriteAt.set(pageKey(anilistId, chapterNumber), ctx.now());
}

/** Saves where the reader stopped. At most one server write per 15 s per chapter;
 *  the newest position is flushed on pagehide/visibilitychange. */
export async function saveLastPage(anilistId: number, chapterNumber: number, page: number): Promise<void> {
  try {
    const key = pageKey(anilistId, chapterNumber);
    const now = Date.now();
    installFlushListeners();

    if (now - (lastWriteAt.get(key) ?? 0) < LAST_PAGE_WRITE_INTERVAL_MS) {
      pendingLastPage.set(key, { anilistId: Number(anilistId), chapterNumber: Number(chapterNumber), page: Number(page) });
      return;
    }

    lastWriteAt.set(key, now);
    await writeLastPage(anilistId, chapterNumber, page);
  } catch {
    /* never break the reader */
  }
}

export async function flushLastPage(): Promise<void> {
  const items = [...pendingLastPage.values()];
  pendingLastPage.clear();
  for (const item of items) {
    await writeLastPage(item.anilistId, item.chapterNumber, item.page);
  }
}

export function subscribeChapters(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => callback();
  window.addEventListener("storage", handler);
  window.addEventListener(CHAPTERS_CHANGE_EVENT, handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(CHAPTERS_CHANGE_EVENT, handler);
  };
}

/** Test seam: clears the throttle bookkeeping. */
export function __resetChaptersForTests(): void {
  lastWriteAt.clear();
  pendingLastPage.clear();
}
