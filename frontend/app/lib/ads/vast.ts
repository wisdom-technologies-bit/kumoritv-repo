// Prompt 40: a small first-party VAST reader.
//
// It is the FALLBACK engine (see docs/ads-adcash.md): the default path uses the
// Google IMA SDK, which is what Adcash's own instructions show. This parser is
// what runs when ima3.js cannot load (blocked, offline, CSP), so the pre-roll can
// still play a plain MP4 creative instead of turning into "no ad".
//
// Scope: VAST 2/3/4 inline ads and wrappers (depth is enforced by the caller),
// linear creative only, MP4 media files only. VPAID is reported as unsupported -
// IMA plays those, we deliberately do not.

export type VastMediaFile = {
  url: string;
  type: string;
  bitrate: number | null;
  width: number | null;
  height: number | null;
  delivery: string | null;
};

export type VastAd = {
  id: string;
  version: string;
  type: "inline" | "wrapper";
  /** Inline only. */
  mediaFiles: VastMediaFile[];
  /** Seconds; null when the tag has no Duration. */
  durationSec: number | null;
  /** Seconds from the start of the ad; null when the tag has no skipoffset. */
  skipOffsetSec: number | null;
  /** Inline only: where "Visit advertiser" goes. */
  clickThrough: string | null;
  clickTracking: string[];
  impressionUrls: string[];
  tracking: Record<string, string[]>;
  errorUrls: string[];
  /** Wrapper only: the next VAST document to fetch. */
  wrapperUrl: string | null;
};

export type VastDocument = {
  version: string;
  ads: VastAd[];
  /** `<VAST><Error>` - fired when the document itself is unusable. */
  errorUrls: string[];
};

export class VastParseError extends Error {}

/** Reasons a pre-roll produced no ad. Each maps to a VAST error code below. */
export type VastFailure =
  | "bad_xml"
  | "no_fill"
  | "timeout"
  | "http_error"
  | "wrapper_limit"
  | "no_media"
  | "unsupported_creative"
  | "media_error"
  | "start_timeout"
  | "ad_too_long"
  | "unknown";

/**
 * VAST 4 error codes. `ad_too_long` has no official code: the creative is
 * playable, we simply refuse to run it, so it is reported as 405 (problem
 * displaying the MediaFile) rather than as a delivery failure.
 */
export function vastErrorCode(reason: VastFailure | string): number {
  switch (reason) {
    case "bad_xml":
      return 100;
    case "timeout":
    case "start_timeout":
      return 301;
    case "http_error":
      return 301;
    case "wrapper_limit":
      return 302;
    case "no_fill":
      return 303;
    case "no_media":
    case "unsupported_creative":
      return 403;
    case "media_error":
    case "ad_too_long":
      return 405;
    default:
      return 900;
  }
}

/** `00:00:05`, `00:05`, `5` and `5.5s` all become seconds. */
export function parseVastDuration(raw: string | null | undefined): number | null {
  const value = String(raw ?? "").trim();

  if (!value) return null;

  const numeric = Number(value.replace(/s$/i, ""));

  if (Number.isFinite(numeric) && !value.includes(":")) return numeric;

  const parts = value.split(":").map((part) => Number(part));

  if (parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];

  return null;
}

/** `skipoffset="00:00:05"`, `"5"`, or a percentage of the ad's duration. */
export function parseSkipOffset(raw: string | null | undefined, durationSec: number | null): number | null {
  const value = String(raw ?? "").trim();

  if (!value) return null;

  if (value.endsWith("%")) {
    const percent = Number.parseFloat(value.slice(0, -1));

    if (!Number.isFinite(percent) || durationSec == null || durationSec <= 0) return null;

    return Math.max(0, Math.min(durationSec, (percent / 100) * durationSec));
  }

  return parseVastDuration(value);
}

/** Direct element children with that tag name. Avoids `:scope`, which jsdom lacks. */
function childrenNamed(node: Element | null | undefined, name: string): Element[] {
  if (!node) return [];

  return Array.from(node.children).filter((child) => child.nodeName.toUpperCase() === name.toUpperCase());
}

function childNamed(node: Element | null | undefined, name: string): Element | null {
  return childrenNamed(node, name)[0] ?? null;
}

function text(node: Element | null | undefined): string {
  return String(node?.textContent ?? "").trim();
}

function texts(parent: Element | null | undefined, selector: string): string[] {
  if (!parent) return [];

  return Array.from(parent.querySelectorAll(selector))
    .map((node) => text(node))
    .filter(Boolean);
}

function attrNumber(node: Element, name: string): number | null {
  const value = Number.parseFloat(node.getAttribute(name) || "");

  return Number.isFinite(value) ? value : null;
}

function parseMediaFiles(linear: Element | null): VastMediaFile[] {
  if (!linear) return [];

  return Array.from(linear.querySelectorAll("MediaFile"))
    .map((node) => ({
      url: text(node),
      type: String(node.getAttribute("type") || "").toLowerCase(),
      bitrate: attrNumber(node, "bitrate"),
      width: attrNumber(node, "width"),
      height: attrNumber(node, "height"),
      delivery: node.getAttribute("delivery"),
    }))
    .filter((file) => Boolean(file.url));
}

function mergeTracking(into: Record<string, string[]>, from: Element | null | undefined) {
  if (!from) return into;

  for (const node of Array.from(from.querySelectorAll("Tracking"))) {
    const event = String(node.getAttribute("event") || "").trim().toLowerCase();
    const url = text(node);

    if (!event || !url) continue;
    // An Inline keeps its TrackingEvents under the Creative, so the same node can
    // be reached twice; a URL is listed once.
    into[event] = Array.from(new Set([...(into[event] || []), url]));
  }

  return into;
}

/**
 * Parses one VAST document. Throws `VastParseError` for unusable XML - the caller
 * treats that as "no ad" and fires the document's Error URL when it has one.
 */
export function parseVast(xml: string): VastDocument {
  const source = String(xml ?? "").trim();

  if (!source) throw new VastParseError("empty document");

  const Parser: typeof DOMParser | undefined =
    (globalThis as any).DOMParser ?? (globalThis as any).window?.DOMParser;

  if (!Parser) throw new VastParseError("no XML parser available");

  const parser = new Parser();
  const doc: any = parser.parseFromString(source, "text/xml");

  if (doc?.querySelector?.("parsererror") || doc?.getElementsByTagName?.("parsererror")?.length) {
    throw new VastParseError("unparseable VAST");
  }

  const root: Element | null = doc?.documentElement ?? null;

  if (!root || root.nodeName.toUpperCase() !== "VAST") throw new VastParseError("not a VAST document");

  const version = root.getAttribute("version") || "";
  const errorUrls = childrenNamed(root, "Error").map(text).filter(Boolean);
  const ads: VastAd[] = [];

  for (const adNode of childrenNamed(root, "Ad")) {
    const inline = childNamed(adNode, "Inline");
    const wrapper = childNamed(adNode, "Wrapper");
    const body = inline || wrapper;

    if (!body) continue;

    const linear = body.querySelector("Linear");
    const tracking: Record<string, string[]> = {};
    const impressionUrls = texts(body, "Impression");
    const creativeTracking = linear?.querySelector("TrackingEvents");
    const bodyTracking = body.querySelector("TrackingEvents");

    mergeTracking(tracking, bodyTracking);
    mergeTracking(tracking, creativeTracking);

    const durationSec = parseVastDuration(text(linear?.querySelector("Duration")));

    ads.push({
      id: adNode.getAttribute("id") || text(childNamed(childNamed(adNode, "Inline"), "AdSystem")) || "",
      version,
      type: inline ? "inline" : "wrapper",
      mediaFiles: inline ? parseMediaFiles(linear) : [],
      durationSec,
      skipOffsetSec: linear
        ? parseSkipOffset(linear.getAttribute("skipoffset"), durationSec)
        : null,
      clickThrough: inline
        ? text(childNamed(childNamed(linear, "VideoClicks"), "ClickThrough")) || null
        : null,
      clickTracking: inline
        ? childrenNamed(childNamed(linear, "VideoClicks"), "ClickTracking").map(text).filter(Boolean)
        : [],
      impressionUrls,
      tracking,
      errorUrls: [...texts(body, "Error"), ...errorUrls],
      wrapperUrl: wrapper ? text(wrapper.querySelector("VASTAdTagURI")) || null : null,
    });
  }

  return { version, ads, errorUrls };
}

export type MediaPickOptions = {
  /** Visible player height in CSS pixels. */
  viewportHeight?: number;
  /** Rough downlink in kbps, when the browser exposes it. */
  bandwidthKbps?: number;
};

/**
 * Picks the best playable MP4 for this viewer. Anything that is not an MP4
 * (VPAID/JS, HLS) is ignored: this engine only plays progressive files, and IMA
 * is the path that handles the rest.
 */
export function pickMediaFile(files: VastMediaFile[], options: MediaPickOptions = {}): VastMediaFile | null {
  const viewport = options.viewportHeight && options.viewportHeight > 0 ? options.viewportHeight : 720;
  const bandwidth = options.bandwidthKbps && options.bandwidthKbps > 0 ? options.bandwidthKbps : 2000;

  const mp4 = files.filter((file) => {
    const type = file.type || "";

    if (!type.includes("mp4")) return false;
    // MIME attributes sometimes carry codec parameters ("video/mp4; codecs=...").
    if (type.includes("vpaid") || type.includes("javascript")) return false;

    return true;
  });

  if (!mp4.length) return null;

  const score = (file: VastMediaFile) => {
    const height = file.height || 0;
    const bitrate = file.bitrate || 0;
    const fitsViewport = height <= viewport + 1;
    const fitsBandwidth = bitrate === 0 || bitrate <= bandwidth;

    // Prefer fitting both, then the closest height, then the highest bitrate.
    return [fitsViewport && fitsBandwidth ? 2 : fitsBandwidth ? 1 : 0, Math.min(height, viewport), bitrate];
  };

  return [...mp4].sort((a, b) => {
    const left = score(a);
    const right = score(b);

    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) return right[index] - left[index];
    }

    return 0;
  })[0] ?? null;
}

export type VastMacros = {
  cacheBusting?: string;
  timestamp?: string;
  errorCode?: number | string;
  contentPlayhead?: string;
  assetUri?: string;
};

/** Replaces the macros a browser VAST client is expected to fill in. */
export function replaceMacros(url: string, macros: VastMacros = {}): string {
  const cacheBusting =
    macros.cacheBusting ??
    String(Math.floor(Math.random() * 900_000_000) + 100_000_000);
  const timestamp = macros.timestamp ?? new Date().toISOString();

  return String(url ?? "")
    .replace(/\[CACHEBUSTING\]/gi, cacheBusting)
    .replace(/\[TIMESTAMP\]/gi, encodeURIComponent(timestamp))
    .replace(/\[ERRORCODE\]/gi, String(macros.errorCode ?? 900))
    .replace(/\[CONTENTPLAYHEAD\]/gi, encodeURIComponent(macros.contentPlayhead ?? "00:00:00.000"))
    .replace(/\[ASSETURI\]/gi, encodeURIComponent(macros.assetUri ?? ""));
}
