// Pure text helpers shared by the SEO metadata builders. No imports from Next,
// React or the database, so they can be unit tested in isolation.

export const SITE_URL_FALLBACK = "https://kumoritv.vercel.app";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  hellip: "…",
  mldr: "…",
  mdash: "—",
  ndash: "–",
  minus: "−",
  lsquo: "‘",
  rsquo: "’",
  sbquo: "‚",
  ldquo: "“",
  rdquo: "”",
  bdquo: "„",
  laquo: "«",
  raquo: "»",
  lsaquo: "‹",
  rsaquo: "›",
  bull: "•",
  middot: "·",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  plusmn: "±",
  times: "×",
  divide: "÷",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  prime: "′",
  Prime: "″",
  hearts: "♥",
  star: "☆",
  starf: "★",
  eacute: "é",
  egrave: "è",
  ecirc: "ê",
  agrave: "à",
  acirc: "â",
  auml: "ä",
  ccedil: "ç",
  iacute: "í",
  iuml: "ï",
  ntilde: "ñ",
  oacute: "ó",
  ocirc: "ô",
  ouml: "ö",
  oslash: "ø",
  uacute: "ú",
  ucirc: "û",
  uuml: "ü",
  szlig: "ß",
  aelig: "æ",
  AElig: "Æ",
  aring: "å",
  Aring: "Å",
  Eacute: "É",
  Ouml: "Ö",
  Uuml: "Ü",
  Auml: "Ä",
};

/** The public site origin, without a trailing slash. */
export function siteUrl(): string {
  const configured = (process.env.NEXT_PUBLIC_SITE_URL || "").trim();
  const base = configured || SITE_URL_FALLBACK;
  return base.replace(/\/+$/, "");
}

/** Turns any site path into an absolute URL on the public origin. */
export function absoluteUrl(path: unknown): string {
  const value = typeof path === "string" ? path.trim() : "";
  if (!value) return `${siteUrl()}/`;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  return `${siteUrl()}${value.startsWith("/") ? value : `/${value}`}`;
}

/** Decodes the HTML entities AniList descriptions actually contain. */
export function decodeEntities(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, code: string) => {
    if (code.startsWith("#")) {
      const hex = code[1] === "x" || code[1] === "X";
      const parsed = Number.parseInt(hex ? code.slice(2) : code.slice(1), hex ? 16 : 10);
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 0x10ffff) return match;
      try {
        return String.fromCodePoint(parsed);
      } catch {
        return match;
      }
    }
    const named = NAMED_ENTITIES[code] ?? NAMED_ENTITIES[code.toLowerCase()];
    return named ?? match;
  });
}

/**
 * Removes markup, decodes entities once and collapses whitespace.
 * `<br>` and block boundaries become a space so words never fuse together.
 */
export function stripHtml(html: unknown): string {
  if (typeof html !== "string") return "";
  if (!html.trim()) return "";
  const withoutMarkup = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(?:p|div|li|h[1-6]|tr|blockquote|section)\s*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ");
  const decoded = decodeEntities(withoutMarkup);
  return decoded.replace(/\s+/g, " ").trim();
}

/** Cuts on a word boundary and appends an ellipsis, never exceeding `max`. */
export function truncate(text: unknown, max: number): string {
  const limit = Math.floor(Number(max));
  if (!Number.isFinite(limit) || limit <= 0) return "";
  const value = (typeof text === "string" ? text : "").replace(/\s+/g, " ").trim();
  if (!value) return "";
  if (value.length <= limit) return value;
  if (limit === 1) return "…";
  const cut = value.slice(0, limit - 1);
  const boundary = cut.lastIndexOf(" ");
  const base = boundary > Math.floor(limit * 0.4) ? cut.slice(0, boundary) : cut;
  const cleaned = base.replace(/[\s,;:.\-–—_/&]+$/u, "");
  return `${cleaned || cut.trimEnd()}…`;
}

const GENERIC_EPISODE_TITLE =
  /^(?:(?:episode|ep|e)\s*[.\-–—:]?\s*(?:no\.?\s*)?\d{1,5}|(?:episode|ep)\s*[.\-–—]?\s*\d{1,5}\s*[.\-–—:]?\s*)$/i;

/** True for placeholder names such as "Episode 5", "EP. 12" and empty strings. */
export function isGenericEpisodeTitle(title: unknown): boolean {
  if (typeof title !== "string") return true;
  const value = title.replace(/\s+/g, " ").trim();
  if (!value) return true;
  if (GENERIC_EPISODE_TITLE.test(value)) return true;
  return /^(?:episode|ep)\s*\d{1,5}$/i.test(value.replace(/[^a-z0-9 ]/gi, "").trim());
}
