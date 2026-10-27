import type { FavouriteSnapshot, MediaCover, MediaTitle, ProgressSnapshot } from "./types";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? (value as UnknownRecord) : {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function normaliseTitle(title: unknown): MediaTitle {
  if (typeof title === "string") return { romaji: title, userPreferred: title };
  const record = asRecord(title);
  const romaji = asString(record.romaji) || asString(record.userPreferred) || asString(record.english);
  return {
    romaji,
    english: (record.english as string | null | undefined) ?? null,
    native: (record.native as string | null | undefined) ?? null,
    userPreferred:
      (record.userPreferred as string | null | undefined) ?? romaji ?? null,
  };
}

function normaliseCover(cover: unknown): MediaCover {
  const record = asRecord(cover);
  const large = asString(record.large) || asString(record.extraLarge);
  const extraLarge = asString(record.extraLarge) || large;
  return { extraLarge, large };
}

/** Same shape the original Firestore `bookmarks` items had. */
export function normaliseSnapshot(media: unknown): FavouriteSnapshot | null {
  const record = asRecord(media);
  const id = Number(record.id);
  if (!Number.isFinite(id)) return null;
  return {
    id,
    title: normaliseTitle(record.title),
    format: asString(record.format, "TV"),
    description: asString(record.description),
    coverImage: normaliseCover(record.coverImage),
  };
}

export function normaliseSnapshotList(list: unknown): FavouriteSnapshot[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => normaliseSnapshot(item))
    .filter((item): item is FavouriteSnapshot => item !== null);
}

export function normaliseProgressSnapshot(snapshot: unknown): ProgressSnapshot {
  if (typeof snapshot === "string") return { title: snapshot, cover: null };
  const record = asRecord(snapshot);
  const title = record.title;
  return {
    title:
      typeof title === "string"
        ? title
        : title
          ? normaliseTitle(title)
          : null,
    cover: (asString(record.cover) || null) as string | null,
  };
}
