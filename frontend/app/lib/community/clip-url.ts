// Prompt 38F: a clip URL, read the one safe way.
//
// Two callers use this and they want different things:
//   * the composer, which watches what is typed and pasted, finds a clip link
//     inside a sentence, remembers its code and removes the link from the text;
//   * validateCreatePost, which receives a `link_url` and must decide whether it
//     is a plain link (kept) or a clip (turned into clip_code).
//
// The rules are small and they are all here, so both callers cannot disagree:
//   ACCEPTED HOSTS  kumoritv.top, www.kumoritv.top, the configured site origin
//                   (NEXT_PUBLIC_SITE_URL, www. included), and localhost /
//                   127.0.0.1 / [::1] with any port outside production.
//   ACCEPTED SCHEME http, https, //, or none at all (`kumoritv.top/clip/...`).
//   ACCEPTED PATH   exactly /clip/<7-character code> and nothing else. A
//                   trailing slash is tolerated; any further segment is not.
//   ACCEPTED CODE   7 characters from app/lib/clips/code's alphabet.
//
// REFUSED, always: another host (evil.com/clip/abc2345), a lookalike
// (kumoritv.top.evil.com), a userinfo URL (https://kumoritv.top@evil.com/clip/...),
// javascript:, data:, and any code of the wrong length or alphabet.
//
// A BARE CODE (`abc2345`) is a clip only in the "Paste clip URL" input, where
// the placeholder says a code is fine. In free text it is just a word, so
// parseClipInput accepts it and extractClipUrl does not.

import { isClipCode } from "@/app/lib/clips/code";
import { CLIP_CODE_LENGTH } from "@/app/lib/clips/constants";
import { SITE_URL_FALLBACK } from "@/app/lib/seo/text";

export type ClipUrlFailure = "empty" | "scheme" | "host" | "path" | "code";

export type ClipUrlResult =
  | { kind: "clip"; code: string; host: string }
  | { kind: "invalid"; reason: ClipUrlFailure };

const BASE_HOSTS = ["kumoritv.top"];

/** The configured public origin, or the fallback, as a bare hostname. */
function configuredHost(): string | null {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL || "").trim();
  if (!raw) return hostOf(SITE_URL_FALLBACK);
  return hostOf(raw) ?? hostOf(SITE_URL_FALLBACK);
}

function hostOf(value: string): string | null {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isDev(): boolean {
  return process.env.NODE_ENV !== "production";
}

/**
 * Every hostname a clip link may use, lowercased. `www.` of each is added, and
 * the local development hosts are added only outside production.
 */
export function allowedClipHosts(): Set<string> {
  const hosts = new Set<string>();
  const add = (host: string | null) => {
    if (!host) return;
    hosts.add(host);
    if (!host.startsWith("www.") && host !== "localhost" && !isIpLiteral(host)) hosts.add(`www.${host}`);
  };

  for (const host of BASE_HOSTS) add(host);
  add(configuredHost());

  if (isDev()) {
    add("localhost");
    add("127.0.0.1");
    add("::1");
    add("[::1]");
  }
  return hosts;
}

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

/** Strips the brackets `new URL` keeps on an IPv6 hostname. */
export function bareHost(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

export function isAllowedClipHost(hostname: string): boolean {
  const host = bareHost(hostname);
  return allowedClipHosts().has(host) || allowedClipHosts().has(`[${host}]`);
}

/**
 * One candidate string -> a verdict. `value` may be a full URL, a `//host/...`
 * URL, a schemeless `host/clip/code`, or (when `allowBareCode`) a bare code.
 */
export function parseClipUrl(value: unknown, options: { allowBareCode?: boolean } = {}): ClipUrlResult {
  if (typeof value !== "string") return { kind: "invalid", reason: "empty" };
  const raw = value.trim();
  if (!raw) return { kind: "invalid", reason: "empty" };

  // javascript:, data:, vbscript:, file: ... never reach the URL parser, and a
  // bare code is the only other thing allowed to have no host.
  // `localhost:3000/clip/abc2345` is a host and a port, not a scheme: a scheme
  // is only a scheme when the colon is not followed by a digit.
  const schemeMatch = /^([a-z][a-z0-9+.-]*):(?!\d)/i.exec(raw);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme !== "http" && scheme !== "https") return { kind: "invalid", reason: "scheme" };
  } else if (options.allowBareCode && isClipCode(raw)) {
    return { kind: "clip", code: raw, host: "" };
  }

  // A userinfo URL is refused before parsing, so `kumoritv.top@evil.com` can
  // never be read as `kumoritv.top`.
  const withoutScheme = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  if (withoutScheme.includes("@")) return { kind: "invalid", reason: "host" };

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/\//, "")}`);
  } catch {
    return { kind: "invalid", reason: "host" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return { kind: "invalid", reason: "scheme" };
  if (url.username || url.password) return { kind: "invalid", reason: "host" };
  if (!isAllowedClipHost(url.hostname)) return { kind: "invalid", reason: "host" };

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 2 || segments[0].toLowerCase() !== "clip") {
    return { kind: "invalid", reason: "path" };
  }
  const code = segments[1];
  if (!isClipCode(code)) return { kind: "invalid", reason: "code" };
  if (url.search || url.hash) {
    // /clip/<code>?t=1 is still the same clip; the extra parts are not a reason
    // to refuse it, and they are not read either.
  }
  return { kind: "clip", code, host: bareHost(url.hostname) };
}

/** The "Paste clip URL" input: a full URL or a bare code, nothing else. */
export function parseClipInput(value: unknown): ClipUrlResult {
  return parseClipUrl(value, { allowBareCode: true });
}

/** Host-shaped substring that might be a clip link inside prose. */
const CANDIDATE =
  /(?:https?:\/\/|\/\/)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d{1,5})?\/clip\/[A-Za-z0-9]+(?:[/?#][^\s<>"'`]*)?|(?:https?:\/\/|\/\/)?(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?\/clip\/[A-Za-z0-9]+(?:[/?#][^\s<>"'`]*)?/gi;

/**
 * Finds a clip link in free text. Returns the code and the text with the link
 * removed, or null when there is no acceptable clip link in it. A non-clip URL
 * (an article, a video, a lookalike host) is left exactly where it was: the
 * composer keeps it as text and the post keeps it as a plain link.
 */
export function extractClipUrl(
  text: unknown,
  options: { siteUrl?: string } = {},
): { code: string; text: string; url: string } | null {
  void options;
  if (typeof text !== "string" || !text) return null;
  CANDIDATE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CANDIDATE.exec(text))) {
    const candidate = match[0];
    const parsed = parseClipUrl(candidate);
    if (parsed.kind !== "clip") continue;
    const rest = `${text.slice(0, match.index)} ${text.slice(match.index + candidate.length)}`
      .replace(/[ \t]{2,}/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .trim();
    return { code: parsed.code, text: rest, url: candidate };
  }
  return null;
}

/** True when the text holds a clip link (used by the composer's hint). */
export function containsClipUrl(text: unknown): boolean {
  return extractClipUrl(text) !== null;
}

/** Human wording for a refused paste, shared by the composer and the API. */
export function clipUrlMessage(result: ClipUrlResult): string | null {
  if (result.kind === "clip") return null;
  switch (result.reason) {
    case "empty":
      return "Paste a clip link first.";
    case "scheme":
      return "Only http and https links are accepted.";
    case "host":
      return "That link is not a KumoriTV clip link.";
    case "path":
      return "A clip link looks like kumoritv.top/clip/abc2345.";
    case "code":
      return `A clip code is ${CLIP_CODE_LENGTH} characters, like abc2345.`;
    default:
      return "That link is not a KumoriTV clip link.";
  }
}
