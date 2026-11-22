// Prompt 40: the fallback pre-roll engine - our own VAST client.
//
// Runs only when ima3.js cannot load (blocked by an ad blocker or a CSP, offline).
// It fetches the VAST document directly from the browser, so the ad server still
// sees the viewer's own IP and user agent: nothing is proxied through our server.
// Plain MP4 creatives only; VPAID is reported as unsupported instead of played.
import {
  BASE_AD_STATE,
  type PrerollAdHandle,
  type PrerollAdState,
  type PrerollStartOptions,
} from "./preroll-engine";
import {
  VastParseError,
  parseVast,
  pickMediaFile,
  replaceMacros,
  vastErrorCode,
  type VastAd,
} from "./vast";

const WRAPPER_DEPTH_LIMIT = 3;

type TrackingBag = {
  impressions: string[];
  errors: string[];
  tracking: Record<string, string[]>;
  clickTracking: string[];
};

const emptyBag = (): TrackingBag => ({ impressions: [], errors: [], tracking: {}, clickTracking: [] });

function addToBag(bag: TrackingBag, ad: VastAd) {
  bag.impressions.push(...ad.impressionUrls);
  bag.errors.push(...ad.errorUrls);
  bag.clickTracking.push(...ad.clickTracking);

  for (const [event, urls] of Object.entries(ad.tracking)) {
    bag.tracking[event] = [...(bag.tracking[event] || []), ...urls];
  }
}

function beacon(url: string, code?: number) {
  try {
    const target = replaceMacros(url, { errorCode: code });
    // `no-cors` + keepalive: a tracking pixel must never block or throw.
    void fetch(target, { mode: "no-cors", keepalive: true, cache: "no-store" }).catch(() => undefined);
  } catch {
    /* a tracker is never allowed to break playback */
  }
}

async function fetchVast(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(replaceMacros(url), {
      signal: controller.signal,
      cache: "no-store",
      credentials: "omit",
      // The ad server must see the viewer, not us: this is a direct browser request.
      mode: "cors",
    });

    if (!response.ok) throw Object.assign(new Error("http_error"), { status: response.status });

    return await response.text();
  } catch (error) {
    if ((error as any)?.name === "AbortError") throw new Error("timeout");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** True for an empty document or `<VAST>` with no usable `<Ad>`: "no ad", not an error. */
function isEmptyVast(xml: string) {
  return !String(xml || "").trim() || /<VAST[^>]*>\s*<\/VAST>/i.test(xml);
}

export async function startVastPreroll(options: PrerollStartOptions): Promise<PrerollAdHandle> {
  const startedAt = Date.now();
  const container = options.container;
  const bag = emptyBag();
  const fired = new Set<string>();
  const timers: number[] = [];
  let done = false;
  let video: HTMLVideoElement | null = null;
  let muted = false;
  let trackElement: HTMLVideoElement | null = null;
  let state: PrerollAdState = {
    ...BASE_AD_STATE,
    engine: "vast",
    customControls: true,
    skipAfterSec: options.skipAfterSec,
    remainingSec: options.maxAdSec,
  };

  const emit = (patch: Partial<PrerollAdState>) => {
    state = { ...state, ...patch };
    options.onState(state);
  };
  const fireOnce = (event: string) => {
    if (fired.has(event)) return;
    fired.add(event);

    for (const url of bag.tracking[event] || []) beacon(url);
  };
  const fireError = (code: number) => {
    for (const url of bag.errors) beacon(url, code);
  };
  const cleanup = () => {
    timers.forEach((id) => window.clearTimeout(id));

    for (const interval of intervals) window.clearInterval(interval);

    if (video) {
      try {
        video.pause();
        video.removeAttribute("src");
        video.load();
        video.remove();
      } catch {
        /* already gone */
      }
    }
    video = null;
  };
  const intervals: number[] = [];
  const finish = (outcome: { kind: "completed" | "skipped" | "no_fill" | "error" | "timeout"; reason?: string; errorCode?: number }) => {
    if (done) return;
    done = true;
    cleanup();
    options.onDone({ ...outcome, ms: Date.now() - startedAt });
  };
  const fail = (reason: string, code = vastErrorCode(reason)) => {
    fireError(code);
    finish({ kind: reason === "no_fill" ? "no_fill" : "error", reason, errorCode: code });
  };

  // ---------------------------------------------------------- resolve the tag
  let ad: VastAd | null = null;

  try {
    let nextUrl: string | null = options.adTagUrl;
    let depth = 0;

    while (nextUrl) {
      if (depth > WRAPPER_DEPTH_LIMIT) {
        fail("wrapper_limit", 302);

        return {
          skip: () => {},
          toggleMute: () => muted,
          destroy: () => {},
        };
      }
      const xml = await fetchVast(nextUrl, options.vastTimeoutMs);

      if (isEmptyVast(xml)) {
        fail("no_fill", 303);
        return { skip: () => {}, toggleMute: () => muted, destroy: () => {} };
      }
      const document = parseVast(xml);

      if (!document.ads.length) {
        fail("no_fill", 303);
        return { skip: () => {}, toggleMute: () => muted, destroy: () => {} };
      }
      const candidate = document.ads[0];

      addToBag(bag, candidate);

      if (candidate.type === "wrapper") {
        nextUrl = candidate.wrapperUrl;
        depth += 1;
        if (!nextUrl) {
          fail("no_fill", 303);
          return { skip: () => {}, toggleMute: () => muted, destroy: () => {} };
        }
        continue;
      }
      ad = candidate;
      nextUrl = null;
    }
  } catch (error) {
    if (error instanceof VastParseError) {
      fail("bad_xml", 100);
    } else if ((error as Error)?.message === "timeout") {
      fail("timeout", 301);
    } else {
      // Blocked by an extension, offline, CORS: silent "no ad", no banner.
      fail("http_error", 301);
    }
    return { skip: () => {}, toggleMute: () => muted, destroy: () => {} };
  }

  if (!ad) {
    fail("no_fill", 303);

    return { skip: () => {}, toggleMute: () => muted, destroy: () => {} };
  }

  const bandwidth = Number((globalThis as any)?.navigator?.connection?.downlink ?? 0) * 1000;
  const media = pickMediaFile(ad.mediaFiles, {
    viewportHeight: Math.round(container.getBoundingClientRect().height) || 720,
    bandwidthKbps: bandwidth > 0 ? bandwidth : undefined,
  });

  if (!media) {
    fail("unsupported_creative", 403);

    return { skip: () => {}, toggleMute: () => muted, destroy: () => {} };
  }

  // ------------------------------------------------------------- play the ad
  const skipAfter = ad.skipOffsetSec ?? options.skipAfterSec;

  video = document.createElement("video");
  video.playsInline = true;
  video.preload = "auto";
  video.setAttribute("aria-hidden", "true");
  video.className = "preroll_ad_video";
  video.style.cssText = "width:100%;height:100%;object-fit:contain;background:#000";
  container.appendChild(video);
  trackElement = video;

  let started = false;
  const startTimer = window.setTimeout(() => {
    if (!started) fail("start_timeout", 301);
  }, options.startTimeoutMs);

  timers.push(startTimer);

  video.addEventListener("loadedmetadata", () => {
    const duration = Number(video?.duration);

    emit({
      remainingSec: Number.isFinite(duration) ? Math.max(0, duration) : null,
      skipAfterSec: skipAfter,
    });
  });
  video.addEventListener("playing", () => {
    started = true;
    window.clearTimeout(startTimer);
    // Prompt 42: `maxAdSec` is a cap on a creative that runs long, not a filter
    // that turns a 31s ad into "no ad". It only starts counting from the first
    // real ad second, so it can never cut a 15-30s fill.
    const duration = Number(video?.duration);
    const capSec =
      Number.isFinite(duration) && duration > 0
        ? Math.min(duration + 2, options.maxAdSec + 2)
        : options.maxAdSec + 2;

    timers.push(
      window.setTimeout(() => {
        if (done) return;
        finish({ kind: "skipped", reason: "ad_too_long", errorCode: 405 });
      }, Math.max(1000, capSec * 1000)),
    );
    emit({ playing: true, skippable: skipAfter <= 0 });
    fireOnce("creativeView");
    fireOnce("start");
    for (const url of bag.impressions) beacon(url);
    // Mute/Unmute tracking follows OUR toggle, not the tag's.
  });
  video.addEventListener("timeupdate", () => {
    const element = video;

    if (!element || !Number.isFinite(element.duration) || element.duration <= 0) return;
    const played = element.currentTime;
    const duration = element.duration;
    const progress = played / duration;

    emit({
      remainingSec: Math.max(0, duration - played),
      skippable: played >= skipAfter,
    });

    if (progress >= 0.25) fireOnce("firstQuartile");
    if (progress >= 0.5) fireOnce("midpoint");
    if (progress >= 0.75) fireOnce("thirdQuartile");
  });
  video.addEventListener("ended", () => {
    fireOnce("complete");
    finish({ kind: "completed" });
  });
  video.addEventListener("error", () => fail("media_error", 405));

  emit({
    skipAfterSec: skipAfter,
    remainingSec: ad.durationSec ?? options.maxAdSec,
    clickThrough: ad.clickThrough,
    skippable: skipAfter <= 0,
  });

  try {
    video.src = media.url;
    const attempt = video.play();

    if (attempt && typeof attempt.catch === "function") {
      attempt.catch(() => {
        // Autoplay refused: our overlay is on top of a user gesture, but a
        // blocked autoplay must still never hold the content hostage.
        if (!started) fail("media_error", 405);
      });
    }
  } catch {
    fail("media_error", 405);
  }

  // Ad seconds are the ad's, never the episode's: the content video is untouched.
  void trackElement;

  return {
    skip: () => {
      fireOnce("skip");
      finish({ kind: "skipped", reason: "skip" });
    },
    toggleMute: () => {
      muted = !muted;
      if (video) video.muted = muted;
      fireOnce(muted ? "mute" : "unmute");
      emit({ muted });

      return muted;
    },
    destroy: () => finish({ kind: "no_fill", reason: "destroyed" }),
  };
}

/** Opens the advertiser's click-through: new tab, no opener, ad paused first. */
export function openAdvertiser(url: string | null, clickTracking: string[] = []) {
  if (!url) return false;
  for (const pixel of clickTracking) beacon(pixel);
  window.open(url, "_blank", "noopener,noreferrer");

  return true;
}
