// Prompt 42: the device details an ad request has to carry.
//
// Adcash's own publisher scripts append the visitor's platform, platform version,
// browser, browser version and page address to every ad request they make. A
// bare `?r=<zone>` tag leaves the ad server reading only the User-Agent header,
// and modern Chrome sends a frozen, reduced one ("Android 10; K"), so a real
// Android 13 phone looks like an unidentified handset - exactly the kind of
// traffic a video advertiser bids low on or skips.
//
// Two things happen here:
//   1. `adRequestContextFrom` reads a User-Agent (plus the browser's client
//      hints, when it has them) into plain fields. Pure, so it is unit-tested.
//   2. `buildAdTagUrl` adds those fields to the tag URL, once, without ever
//      overwriting a parameter the tag already carries.
//
// Nothing here is secret: the values are the viewer's own browser facts, the
// same ones the request already exposes in headers. The tag URL is still read
// from the environment at request time and never hard-coded.

export type AdRequestContext = {
  /** The page the ad is requested from. */
  pageUrl: string;
  /** `android`, `ios`, `windows`, `macos`, `linux`, `chromeos`, `other`. */
  os: string;
  /** `13`, `17.2`, `10.0`... empty when the browser hides it. */
  osVersion: string;
  /** `chrome`, `safari`, `firefox`, `edge`, `opera`, `samsung`, `other`. */
  browser: string;
  /** `120.0.6099.144`, `17.2`... empty when the browser hides it. */
  browserVersion: string;
};

/** The subset of `navigator.userAgentData` this module reads. */
export type UserAgentHints = {
  platform?: string;
  platformVersion?: string;
  uaFullVersion?: string;
  brands?: Array<{ brand?: string; version?: string }>;
  fullVersionList?: Array<{ brand?: string; version?: string }>;
};

/** A brand string that only exists to fill the list is not a browser name. */
const NOT_A_BRAND = /not[\s_-]*a[\s_.-]*brand/i;

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseOs(ua: string): { os: string; osVersion: string } {
  const android = /Android\s+([\d.]+)/i.exec(ua);

  if (android) return { os: "android", osVersion: android[1] };

  // iPhone OS 17_2, CPU OS 17_2 (iPad on desktop mode).
  const ios = /(?:iPhone|iPad|iPod).*?OS\s+(\d+(?:_\d+)*)/i.exec(ua);

  if (ios) return { os: "ios", osVersion: ios[1].replace(/_/g, ".") };
  if (/iPad|iPhone|iPod/i.test(ua)) return { os: "ios", osVersion: "" };

  const windows = /Windows NT\s+([\d.]+)/i.exec(ua);

  if (windows) return { os: "windows", osVersion: windows[1] };

  const mac = /Mac OS X\s+(\d+(?:_\d+)*)/i.exec(ua);

  if (mac) return { os: "macos", osVersion: mac[1].replace(/_/g, ".") };
  if (/CrOS/i.test(ua)) return { os: "chromeos", osVersion: "" };
  if (/Linux|X11/i.test(ua)) return { os: "linux", osVersion: "" };

  return { os: "other", osVersion: "" };
}

/** Order matters: every Chromium fork also says "Chrome", and Chrome says "Safari". */
const BROWSERS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /Edg(?:e|A|iOS)?\/([\d.]+)/, name: "edge" },
  { pattern: /OPR\/([\d.]+)|Opera\/([\d.]+)/, name: "opera" },
  { pattern: /SamsungBrowser\/([\d.]+)/, name: "samsung" },
  { pattern: /YaBrowser\/([\d.]+)/, name: "yandex" },
  { pattern: /CriOS\/([\d.]+)/, name: "chrome" },
  { pattern: /FxiOS\/([\d.]+)/, name: "firefox" },
  { pattern: /Firefox\/([\d.]+)/, name: "firefox" },
  { pattern: /Chrome\/([\d.]+)/, name: "chrome" },
  { pattern: /Version\/([\d.]+).*Safari/, name: "safari" },
];

function parseBrowser(ua: string): { browser: string; browserVersion: string } {
  for (const { pattern, name } of BROWSERS) {
    const match = pattern.exec(ua);

    if (match) return { browser: name, browserVersion: clean(match[1] ?? match[2]) };
  }

  return { browser: "other", browserVersion: "" };
}

/** `Google Chrome` -> `chrome`, so the value matches what the UA parser reports. */
function browserFromBrand(brand: string): string {
  const value = brand.toLowerCase();

  if (value.includes("edge")) return "edge";
  if (value.includes("opera") || value.includes("opr")) return "opera";
  if (value.includes("samsung")) return "samsung";
  if (value.includes("yandex")) return "yandex";
  if (value.includes("firefox")) return "firefox";
  if (value.includes("safari")) return "safari";
  if (value.includes("chrome")) return "chrome";
  if (value.includes("chromium")) return "chrome";

  return "other";
}

/** The first real brand entry: client hints list the wrapper brand first. */
function realBrand(list: Array<{ brand?: string; version?: string }> | undefined) {
  if (!Array.isArray(list)) return null;

  for (const entry of list) {
    const brand = clean(entry?.brand);

    if (brand && !NOT_A_BRAND.test(brand)) return { brand, version: clean(entry?.version) };
  }

  return null;
}

function platformSlug(platform: string): string {
  const value = platform.trim().toLowerCase();

  if (!value) return "";
  if (value.startsWith("android")) return "android";
  if (value.startsWith("ios") || value.startsWith("ipados")) return "ios";
  if (value.startsWith("windows")) return "windows";
  if (value.startsWith("mac")) return "macos";
  if (value.startsWith("chrome os") || value.startsWith("chromeos")) return "chromeos";
  if (value.startsWith("linux")) return "linux";

  return "";
}

/**
 * Turns a User-Agent into the fields the tag needs. Client hints win when they
 * are present: they carry the real Android version that the UA string froze.
 */
export function adRequestContextFrom(
  userAgent: string,
  pageUrl = "",
  hints: UserAgentHints | null = null,
): AdRequestContext {
  const ua = clean(userAgent);
  const parsedOs = parseOs(ua);
  const parsedBrowser = parseBrowser(ua);
  const brand = realBrand(hints?.fullVersionList) ?? realBrand(hints?.brands);
  const hintedOs = platformSlug(clean(hints?.platform));

  return {
    pageUrl: clean(pageUrl),
    os: hintedOs || parsedOs.os,
    // `platformVersion` is only present after the high-entropy call resolves.
    osVersion: clean(hints?.platformVersion) || parsedOs.osVersion,
    browser: brand ? browserFromBrand(brand.brand) : parsedBrowser.browser,
    browserVersion: clean(hints?.uaFullVersion) || clean(brand?.version) || parsedBrowser.browserVersion,
  };
}

/**
 * Adds the context to the tag URL. A parameter the tag already carries is left
 * exactly as it is, an empty value is never sent, and a tag that is not a valid
 * https URL is returned untouched (the config layer already refuses those).
 */
export function buildAdTagUrl(
  tagUrl: string,
  context: AdRequestContext,
  cacheBust: number | string = Date.now(),
): string {
  let url: URL;

  try {
    url = new URL(tagUrl);
  } catch {
    return tagUrl;
  }

  if (url.protocol !== "https:") return tagUrl;

  const entries: Array<[string, string]> = [
    // One request per play: without it a cached empty answer can stick.
    ["cb", String(cacheBust)],
    ["url", context.pageUrl],
    ["os", context.os],
    ["osv", context.osVersion],
    ["br", context.browser],
    ["brv", context.browserVersion],
  ];

  for (const [key, rawValue] of entries) {
    const value = clean(rawValue);

    if (!value) continue;
    // Case-insensitive: `URL` params on ad servers are not reliably cased.
    if (Array.from(url.searchParams.keys()).some((existing) => existing.toLowerCase() === key)) continue;
    url.searchParams.set(key, value);
  }

  return url.toString();
}

// ------------------------------------------------------------- browser glue

let primedContext: AdRequestContext | null = null;
let priming: Promise<void> | null = null;

/** Test hook: the module-level cache must not leak between cases. */
export function resetAdRequestContextForTests(): void {
  primedContext = null;
  priming = null;
}

function currentPageUrl(): string {
  try {
    return typeof window === "undefined" ? "" : window.location?.href || "";
  } catch {
    return "";
  }
}

type NavigatorHintsApi = {
  userAgent?: string;
  userAgentData?: {
    platform?: string;
    brands?: unknown;
    getHighEntropyValues?: (hints: string[]) => Promise<unknown>;
  };
};

/** `navigator` without an `any`: only the two fields this module reads. */
function navigatorApi(): NavigatorHintsApi | undefined {
  return (globalThis as { navigator?: NavigatorHintsApi }).navigator;
}

function brandList(value: unknown): Array<{ brand?: string; version?: string }> | undefined {
  return Array.isArray(value) ? (value as Array<{ brand?: string; version?: string }>) : undefined;
}

function stringField(source: unknown, key: string): string {
  if (!source || typeof source !== "object") return "";

  return clean((source as Record<string, unknown>)[key]);
}

function lowEntropyHints(): UserAgentHints | null {
  const data = navigatorApi()?.userAgentData;

  if (!data) return null;

  return { platform: clean(data.platform), brands: brandList(data.brands) };
}

/**
 * Reads the high-entropy client hints once, early (the watch page calls this
 * before Play). Chrome answers with the real Android version and browser
 * version; Safari and Firefox simply have no `userAgentData` and fall back to
 * the parsed User-Agent.
 */
export async function primeAdRequestContext(): Promise<AdRequestContext | null> {
  const nav = navigatorApi();

  if (!nav) return null;
  if (priming) {
    await priming;

    return primedContext;
  }

  priming = (async () => {
    const data = nav.userAgentData;
    let hints: UserAgentHints | null = lowEntropyHints();

    try {
      if (data?.getHighEntropyValues) {
        const high = await data.getHighEntropyValues([
          "platform",
          "platformVersion",
          "uaFullVersion",
          "fullVersionList",
        ]);

        hints = {
          ...hints,
          platform: stringField(high, "platform") || hints?.platform,
          platformVersion: stringField(high, "platformVersion"),
          uaFullVersion: stringField(high, "uaFullVersion"),
          fullVersionList: brandList((high as Record<string, unknown> | null)?.fullVersionList),
        };
      }
    } catch {
      // A refused or failed hints call is not an error: the UA string still works.
      hints = lowEntropyHints();
    }

    primedContext = adRequestContextFrom(clean(nav.userAgent), currentPageUrl(), hints);
  })();

  try {
    await priming;
  } catch {
    priming = null;
  }

  return primedContext;
}

/** The context to send now: the primed one when it exists, otherwise fresh. */
export function currentAdRequestContext(pageUrl = currentPageUrl()): AdRequestContext {
  if (primedContext) return { ...primedContext, pageUrl };

  return adRequestContextFrom(clean(navigatorApi()?.userAgent), pageUrl, lowEntropyHints());
}
