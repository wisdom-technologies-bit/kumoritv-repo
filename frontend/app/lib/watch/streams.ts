// ONE normaliser for every AniVexa watch response shape.
//
// Providers disagree about the payload (`streams[]`, reanime's `streams` +
// `embeds`, mkissa's `sources[]`), so the rest of the app only ever sees this
// common list. An unknown shape is never an error: it is an empty list.

import { normalizeIntroOutro } from "./intro";

export type StreamType = "hls" | "mp4" | "embed";

export type SkipRange = { start: number; end: number };

export type NormalizedStream = {
  index: number;
  type: StreamType;
  url: string;
  embedUrl?: string;
  /** Server label exactly as the provider gives it (trimmed), e.g. "HD-1". */
  server: string;
  referer?: string;
  headers?: Record<string, string>;
  subtitles?: unknown[];
  intro: SkipRange | null;
  outro: SkipRange | null;
  priority: number;
  isActive: boolean;
  quality?: string;
  backup?: boolean;
  /** The untouched provider object, kept for callers that need extra fields. */
  raw: any;
};

/** A provider server button: one per distinct server name. */
export type ServerButton = {
  id: string;
  label: string;
  streams: NormalizedStream[];
  primary: NormalizedStream;
  fallback?: NormalizedStream;
  active: boolean;
};

const EMBED_SUFFIX = /-?\s*embed$/i;

const text = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

function streamType(value: unknown, fallbackUrl = ""): StreamType | null {
  const type = text(value).toLowerCase();
  if (type === "hls" || type === "application/x-mpegurl" || type === "m3u8")
    return "hls";
  if (type === "mp4" || type === "video/mp4") return "mp4";
  if (type === "embed" || type === "iframe") return "embed";
  if (type) return null;
  const url = fallbackUrl.toLowerCase();
  if (url.includes(".m3u8")) return "hls";
  if (url.includes(".mp4")) return "mp4";
  return null;
}

/** mkissa only: `name` / `sourceName` is a server name unless it is a URL. */
function nameLooksHuman(value: unknown) {
  const name = text(value);
  if (!name) return "";
  if (/^https?:\/\//i.test(name)) return "";
  if (name.includes("/")) return "";
  return name;
}

function normalizeOne(
  item: any,
  index: number,
  source: "stream" | "embed" | "mkissa",
  json: any,
): NormalizedStream | null {
  if (!item || typeof item !== "object") return null;

  const rawUrl = text(item.extractedUrl) || text(item.url) || text(item.src);
  const type =
    source === "mkissa"
      ? "embed"
      : source === "embed"
        ? "embed"
        : streamType(item.type, rawUrl);
  if (!type) return null;
  const url = rawUrl || text(item.embedUrl) || text(item.embed);
  if (!url) return null;

  const label =
    source === "mkissa"
      ? nameLooksHuman(item.name) ||
        nameLooksHuman(item.sourceName) ||
        `Server ${index + 1}`
      : text(item.server) || text(item.name) || `Server ${index + 1}`;

  const headers =
    item.headers && typeof item.headers === "object" ? item.headers : undefined;
  const referer =
    text(item.referer) ||
    (headers as Record<string, unknown> | undefined)?.Referer?.toString?.() ||
    undefined;

  const ranges =
    source === "mkissa"
      ? { intro: { start: 0, end: 0 }, outro: { start: 0, end: 0 } }
      : normalizeIntroOutro(json, item);

  return {
    index,
    type,
    url,
    ...(type === "embed"
      ? { embedUrl: text(item.embedUrl) || text(item.extractedUrl) || url }
      : {}),
    server: label,
    ...(referer ? { referer } : {}),
    ...(headers ? { headers: headers as Record<string, string> } : {}),
    ...(Array.isArray(item.subtitles) ? { subtitles: item.subtitles } : {}),
    intro: ranges.intro,
    outro: ranges.outro,
    priority: Number(item.priority) || 0,
    isActive: item.isActive === true || item.active === true,
    ...(text(item.quality) ? { quality: text(item.quality) } : {}),
    ...(item.backup === true ? { backup: true } : {}),
    raw: item,
  };
}

/**
 * Turns any provider response into the common stream list.
 * Reads `streams[]`, reanime's `streams` + `embeds`, and mkissa's `sources[]`.
 * Returns [] (never throws) for an unknown shape.
 */
export function normalizeProviderStreams(json: any): NormalizedStream[] {
  try {
    if (!json || typeof json !== "object") return [];
    const out: NormalizedStream[] = [];

    if (Array.isArray(json.streams))
      json.streams.forEach((item: any, i: number) => {
        const stream = normalizeOne(item, out.length, "stream", json);
        if (stream) out.push(stream);
      });

    if (Array.isArray(json.embeds))
      json.embeds.forEach((item: any) => {
        const value =
          typeof item === "string" ? { url: item, type: "embed" } : item;
        const stream = normalizeOne(value, out.length, "embed", json);
        if (stream) out.push(stream);
      });

    if (Array.isArray(json.sources))
      json.sources.forEach((item: any) => {
        const stream = normalizeOne(item, out.length, "mkissa", json);
        if (stream) out.push(stream);
      });

    return out;
  } catch {
    return [];
  }
}

const sameLabel = (a: unknown, b: unknown) =>
  text(a).toLowerCase() === text(b).toLowerCase();

/** "Animegg-embed" and "Animegg" are the same server. */
export function serverButtonKey(label: string) {
  return text(label).toLowerCase().replace(EMBED_SUFFIX, "").trim();
}

/** Lower priority number first (1 is the main server); a missing one goes last. */
const priorityRank = (stream: NormalizedStream) =>
  Number.isFinite(stream.priority) && stream.priority > 0
    ? stream.priority
    : Number.MAX_SAFE_INTEGER;

const typeRank = (stream: NormalizedStream) =>
  stream.type === "hls" ? 0 : stream.type === "mp4" ? 1 : 2;

function comparator(requestedServer?: string | null) {
  return (a: NormalizedStream, b: NormalizedStream) =>
    Number(Boolean(requestedServer) && sameLabel(b.server, requestedServer)) -
      Number(Boolean(requestedServer) && sameLabel(a.server, requestedServer)) ||
    Number(b.isActive === true) - Number(a.isActive === true) ||
    // Lower priority number wins (1 is the main server), then source order.
    priorityRank(a) - priorityRank(b) ||
    Number(a.index || 0) - Number(b.index || 0) ||
    typeRank(a) - typeRank(b);
}

const slug = (label: string) =>
  serverButtonKey(label).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * ONE button per distinct server name (case-insensitive, "-embed" merged).
 * The same name served as hls and embed keeps the hls stream and the embed one
 * as that button's fallback.
 */
export function buildServerButtons(
  streams: NormalizedStream[],
  options: { requestedServer?: string | null } = {},
): ServerButton[] {
  const compare = comparator(options.requestedServer);
  const groups = new Map<string, NormalizedStream[]>();

  for (const stream of streams) {
    const key = serverButtonKey(stream.server) || `server-${stream.index + 1}`;
    const group = groups.get(key);
    if (group) group.push(stream);
    else groups.set(key, [stream]);
  }

  const buttons: ServerButton[] = [];
  const usedIds = new Set<string>();

  for (const [key, group] of groups) {
    // hls always beats embed for the same name, then the usual order applies.
    const ordered = [...group].sort(
      (a, b) => typeRank(a) - typeRank(b) || compare(a, b),
    );
    const primary = ordered[0];
    const fallback = ordered.find(
      (stream) => stream !== primary && stream.type === "embed",
    );
    // A plain name wins over its "-embed" twin so the button reads "Animegg".
    const plain = group.find((stream) => !EMBED_SUFFIX.test(stream.server));
    const label = (plain?.server || primary.server).trim();
    let id = slug(label) || key;
    while (usedIds.has(id)) id = `${id}-2`;
    usedIds.add(id);
    buttons.push({
      id,
      label,
      streams: ordered,
      primary,
      ...(fallback ? { fallback } : {}),
      active: false,
    });
  }

  return buttons.sort((a, b) => compare(a.primary, b.primary));
}

/** Which button owns the stream the route picked. */
export function activeServerId(
  buttons: ServerButton[],
  stream: NormalizedStream | null | undefined,
) {
  if (!stream) return "";
  const found = buttons.find((button) =>
    button.streams.some(
      (candidate) =>
        candidate.raw === stream.raw ||
        (candidate.server === stream.server && candidate.url === stream.url),
    ),
  );
  return found?.id || "";
}

/** Public server list: no provider name ever reaches this shape. */
export function toServerList(
  buttons: ServerButton[],
  activeId: string,
): { id: string; label: string; active: boolean }[] {
  return buttons.map((button) => ({
    id: button.id,
    label: button.label,
    active: button.id === activeId,
  }));
}
