// Prompt 40: the default pre-roll engine - Google IMA for HTML5.
//
// The SDK is loaded lazily, only on the watch page and only when the pre-roll
// flag is on, and it fetches the VAST tag itself. That is why it is the default:
// the ad server sees the viewer's own IP and user agent (nothing is proxied), the
// request is not subject to CORS, and VPAID / wrapper tags work - Adcash's own
// documentation shows Video.js + `videojs-ima`, i.e. exactly this SDK.
//
// The ad plays in a <video> WE create inside the overlay, never in the content
// element, so ad seconds can never reach progress saving.
//
// Prompt 42 (why the ad never appeared on the live site):
//   1. The manager was built with `new ima.AdsManager(...)`. That is not a
//      constructor in Google's library: the SDK hands you the manager through
//      `event.getAdsManager(video, settings)`. Every real ad therefore threw and
//      was reported as `ima_manager_error`, so a fill was indistinguishable from
//      a failure.
//   2. IMA was only asked to initialise after `await loadImaSdk()`, which on a
//      phone drops the viewer's Play gesture. `initialize()` then ran without
//      user activation and the ad could not play with sound. The watch page now
//      primes the SDK before the tap (see `VideoPlayer/index.tsx`), so the
//      gesture survives.
//   3. The tag was requested bare. `buildAdTagUrl` now sends the platform,
//      platform version, browser, browser version and page address the way
//      Adcash's own scripts do (see `ad-request.ts`).
import { buildAdTagUrl, currentAdRequestContext, primeAdRequestContext } from "./ad-request";
import {
  BASE_AD_STATE,
  type PrerollAdHandle,
  type PrerollAdState,
  type PrerollOutcome,
  type PrerollStartOptions,
} from "./preroll-engine";

export const IMA_SCRIPT_SRC = "https://imasdk.googleapis.com/js/sdkloader/ima3.js";

/** Extra ad seconds granted on top of the configured cap before it is enforced. */
const AD_CAP_GRACE_SEC = 2;

let sdkPromise: Promise<void> | null = null;

/** Resolves once `google.ima.AdsLoader` exists; rejects when the script cannot load. */
export function loadImaSdk(timeoutMs = 8000): Promise<void> {
  const scope = globalThis as any;

  if (scope?.google?.ima?.AdsLoader) return Promise.resolve();

  if (typeof document === "undefined") return Promise.reject(new Error("ima_no_document"));

  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise<void>((resolve, reject) => {
    const started = Date.now();
    let settled = false;
    const script = document.querySelector<HTMLScriptElement>(`script[src="${IMA_SCRIPT_SRC}"]`)
      ?? document.createElement("script");
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearInterval(poll);
      script.removeEventListener("error", onError);
      script.removeEventListener("load", onLoad);

      if (error) {
        // A dead SDK must not poison a later retry.
        sdkPromise = null;
        reject(error);

        return;
      }
      resolve();
    };
    const onLoad = () => {
      if (scope?.google?.ima?.AdsLoader) finish();
    };
    const onError = () => finish(new Error("ima_script_error"));
    // The tag can be created without a load event (already in the document).
    const poll = window.setInterval(() => {
      if (scope?.google?.ima?.AdsLoader) {
        finish();

        return;
      }
      if (Date.now() - started > timeoutMs) finish(new Error("ima_script_timeout"));
    }, 100);

    script.addEventListener("load", onLoad);
    script.addEventListener("error", onError);

    if (!script.parentNode) {
      script.src = IMA_SCRIPT_SRC;
      script.async = true;
      script.crossOrigin = "anonymous";
      document.head.appendChild(script);
    }
  });

  return sdkPromise;
}

type ImaWindow = any;

/** The parts of IMA's `Ad` this engine reads. */
type ImaAd = {
  getSkipTimeOffset?: () => number;
  getClickThroughUrl?: () => string;
  getDuration?: () => number;
};

/** A non-throwing read: every IMA getter can throw before an ad exists. */
function safeGet<T>(read: () => T, fallback: T): T {
  try {
    const value = read();

    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

/** IMA wants a slot size; a not-yet-laid-out overlay must not become 1x1. */
function slotSize(container: HTMLElement) {
  const rect = safeGet<DOMRect | null>(() => container.getBoundingClientRect(), null);
  const width = Math.max(1, Math.round(Number(rect?.width) || 0));
  const height = Math.max(1, Math.round(Number(rect?.height) || 0));

  return {
    width: width > 1 ? width : 640,
    height: height > 1 ? height : 360,
  };
}

/**
 * Runs one pre-roll through IMA. IMA renders its own ad badge, countdown, skip
 * button and click-through inside our container, so `customControls` stays false.
 * When the creative has no `skipoffset` IMA never offers a skip, and `localSkip`
 * turns on our own 5-second Skip button instead (Prompt 42).
 */
export async function startImaPreroll(options: PrerollStartOptions): Promise<PrerollAdHandle> {
  const startedAt = Date.now();
  const scope = globalThis as ImaWindow;
  const container = options.container;
  let done = false;
  let adsManager: ImaWindow = null;
  let adsLoader: ImaWindow = null;
  let adDisplayContainer: ImaWindow = null;
  let video: HTMLVideoElement | null = null;
  let capTimer = 0;
  let startTimer = 0;
  let remainingTimer = 0;
  let muted = false;
  let state: PrerollAdState = {
    ...BASE_AD_STATE,
    engine: "ima",
    skipAfterSec: options.skipAfterSec,
    remainingSec: options.maxAdSec,
  };
  const emit = (patch: Partial<PrerollAdState>) => {
    state = { ...state, ...patch };
    options.onState(state);
  };
  const cleanup = () => {
    window.clearTimeout(capTimer);
    window.clearTimeout(startTimer);
    window.clearInterval(remainingTimer);
    try {
      adsManager?.destroy?.();
    } catch {
      /* already gone */
    }
    adsManager = null;
    try {
      adsLoader?.destroy?.();
    } catch {
      /* already gone */
    }
    adsLoader = null;
    try {
      adDisplayContainer?.destroy?.();
    } catch {
      /* already gone */
    }
    adDisplayContainer = null;
    try {
      video?.remove();
    } catch {
      /* already gone */
    }
    video = null;
  };
  const finish = (outcome: Omit<PrerollOutcome, "ms">) => {
    if (done) return;
    done = true;
    cleanup();
    options.onDone({ ...outcome, ms: Date.now() - startedAt });
  };

  // Loading the SDK is the only step that can fall back to the other engine.
  // It is already loaded on the watch page (primed before the Play tap), so this
  // resolves on a microtask and the gesture is still valid.
  try {
    await Promise.all([loadImaSdk(options.startTimeoutMs), primeAdRequestContext().catch(() => null)]);
  } catch (error) {
    throw Object.assign(new Error("ima_unavailable"), {
      fallback: true,
      reason: (error as Error)?.message || "ima_unavailable",
    });
  }

  try {
    const ima = scope.google.ima;
    ima.settings?.setDisableCustomPlaybackForIOS10Plus?.(true);

    video = document.createElement("video");
    video.playsInline = true;
    video.setAttribute("aria-hidden", "true");
    video.className = "preroll_ad_video";
    video.style.cssText = "width:100%;height:100%;object-fit:contain;background:#000";
    container.appendChild(video);

    adDisplayContainer = new ima.AdDisplayContainer(container, video);
    adsLoader = new ima.AdsLoader(adDisplayContainer);

    adsLoader.addEventListener(
      ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED,
      (event: ImaWindow) => {
        try {
          // Prompt 42: the SDK owns the manager. `new ima.AdsManager(...)` does
          // not exist, which is why every filled ad failed before.
          const renderingSettings = new ima.AdsRenderingSettings();
          // Keep IMA's own UI: it owns the countdown and the click-through, which
          // is what the tag's policy expects. Our overlay adds the "Ad" badge.
          renderingSettings.uiElements = [
            ima.UiElements.AD_ATTRIBUTION,
            ima.UiElements.COUNTDOWN,
            ima.UiElements.SKIP,
            ima.UiElements.CLICK_THROUGH,
          ];
          renderingSettings.restoreCustomPlaybackStateOnAdBreakComplete = true;
          adsManager = event.getAdsManager(video, renderingSettings);

          const slot = slotSize(container);

          adsManager.init(slot.width, slot.height, ima.ViewMode.NORMAL);
          try {
            adsManager.setVolume?.(1);
          } catch {
            /* volume is a nicety */
          }
          adsManager.start();
          emit({ playing: false });

          const syncTime = () => {
            const remaining = Number(safeGet(() => adsManager?.getRemainingTime?.(), NaN));

            if (Number.isFinite(remaining)) emit({ remainingSec: Math.max(0, remaining) });
          };

          remainingTimer = window.setInterval(syncTime, 250);

          adsManager.addEventListener(ima.AdEvent.Type.LOADED, () => {
            const ad = safeGet<ImaAd | null>(() => adsManager?.getCurrentAd?.(), null);
            const clickThrough = String(safeGet(() => ad?.getClickThroughUrl?.(), "") || "") || null;
            const duration = Number(safeGet(() => ad?.getDuration?.(), NaN));

            emit({
              clickThrough,
              remainingSec: Number.isFinite(duration) ? Math.max(0, duration) : state.remainingSec,
            });
          });

          adsManager.addEventListener(ima.AdEvent.Type.STARTED, () => {
            const ad = safeGet<ImaAd | null>(() => adsManager?.getCurrentAd?.(), null);
            // -1 means the creative is not skippable at all; IMA then shows no
            // skip and we time our own (Prompt 42).
            const skipOffset = Number(safeGet(() => ad?.getSkipTimeOffset?.(), -1));
            const hasOwnSkip = Number.isFinite(skipOffset) && skipOffset >= 0;
            const clickThrough = String(safeGet(() => ad?.getClickThroughUrl?.(), "") || "") || null;

            emit({
              playing: true,
              remainingSec: state.remainingSec ?? options.maxAdSec,
              clickThrough,
              skipAfterSec: hasOwnSkip ? skipOffset : options.skipAfterSec,
              localSkip: !hasOwnSkip,
              skippable: Boolean(safeGet(() => adsManager?.getAdSkippableState?.(), false)),
            });

            // Prompt 42: the cap only ever stops an ad that is LONGER than the
            // budget. It used to be a flat `maxAdSec` timer, which cut a 15-30s
            // creative (and every ad the overlay's 8s hard stop touched) short.
            const remaining = Number(safeGet(() => adsManager?.getRemainingTime?.(), NaN));
            const capSec = Math.max(0, Number(options.maxAdSec) || 0);
            const budgetSec =
              Number.isFinite(remaining) && remaining > 0
                ? Math.min(remaining + AD_CAP_GRACE_SEC, capSec + AD_CAP_GRACE_SEC)
                : capSec + AD_CAP_GRACE_SEC;

            window.clearTimeout(capTimer);
            capTimer = window.setTimeout(() => {
              if (done) return;
              try {
                adsManager?.stop?.();
              } catch {
                /* already stopped */
              }
              finish({ kind: "skipped", reason: "ad_too_long" });
            }, Math.max(1000, budgetSec * 1000));
          });
          adsManager.addEventListener(ima.AdEvent.Type.AD_PROGRESS, () => {
            syncTime();
            emit({ skippable: Boolean(safeGet(() => adsManager?.getAdSkippableState?.(), false)) });
          });
          adsManager.addEventListener(ima.AdEvent.Type.SKIPPABLE_STATE_CHANGED, () =>
            emit({ skippable: Boolean(safeGet(() => adsManager?.getAdSkippableState?.(), false)) }),
          );
          adsManager.addEventListener(ima.AdEvent.Type.SKIPPED, () =>
            finish({ kind: "skipped", reason: "skip" }),
          );
          adsManager.addEventListener(ima.AdEvent.Type.COMPLETE, () => {});
          adsManager.addEventListener(ima.AdEvent.Type.ALL_ADS_COMPLETED, () =>
            finish({ kind: "completed" }),
          );
          adsManager.addEventListener(ima.AdEvent.Type.CONTENT_PAUSE_REQUESTED, () => {});
          adsManager.addEventListener(ima.AdEvent.Type.CONTENT_RESUME_REQUESTED, () => {});
          adsManager.addEventListener(ima.AdErrorEvent.Type.AD_ERROR, (errorEvent: ImaWindow) => {
            const code = Number(safeGet(() => errorEvent?.getError?.()?.getErrorCode?.(), 900));
            const safe = Number.isFinite(code) ? code : 900;

            // Nothing has played yet: this is not a broken ad for the viewer, it is
            // "no ad" (empty VAST, no bid, unsupported creative). The content goes
            // straight on and the no-fill cooldown starts.
            if (!state.playing) {
              finish({ kind: "no_fill", reason: `ima_no_fill_${safe}`, errorCode: safe });

              return;
            }
            finish({ kind: "error", reason: "ad_error", errorCode: safe });
          });
        } catch {
          // Reached only if the SDK itself is broken: the content plays instead.
          finish({ kind: "error", reason: "ima_manager_error" });
        }
      },
    );
    adsLoader.addEventListener(ima.AdErrorEvent.Type.AD_ERROR, (event: ImaWindow) => {
      // No fill is not an error for the viewer: the content simply plays.
      const message = String(safeGet(() => event?.getError?.()?.getMessage?.(), "") || "");
      const noFill = /no ad|no ads|empty|VAST response/i.test(message) || !state.playing;

      finish({ kind: noFill ? "no_fill" : "error", reason: noFill ? "ima_no_fill" : "ima_error" });
    });

    const request = new ima.AdsRequest();
    const slot = slotSize(container);

    // Prompt 42: the same device details Adcash's own scripts attach, so the ad
    // server does not see a bare zone id behind a reduced User-Agent.
    request.adTagUrl = buildAdTagUrl(options.adTagUrl, currentAdRequestContext());
    request.linearAdSlotWidth = slot.width;
    request.linearAdSlotHeight = slot.height;
    request.nonLinearAdSlotWidth = slot.width;
    request.nonLinearAdSlotHeight = Math.max(1, Math.round(Math.min(slot.height, 120)));
    // Prompt 41: without this IMA waits its own 5s on a tag that answers with an
    // empty <VAST/>. The owner's provider does exactly that today.
    request.vastLoadTimeout = Math.max(500, Math.round(options.vastTimeoutMs));
    // The Play tap is the gesture: initialize() must run inside it, which is why
    // the SDK is primed before the tap rather than awaited here.
    adDisplayContainer.initialize();
    adsLoader.requestAds(request);

    // Nothing started within the budget: treat as no ad, never hold the viewer.
    startTimer = window.setTimeout(() => {
      if (!done && !state.playing) finish({ kind: "timeout", reason: "start_timeout", errorCode: 301 });
    }, options.startTimeoutMs);
  } catch {
    finish({ kind: "error", reason: "ima_setup_failed" });
  }

  return {
    skip: () => {
      if (done) return;
      // A skippable creative is skipped through IMA so its own tracking fires.
      if (Boolean(safeGet(() => adsManager?.getAdSkippableState?.(), false))) {
        try {
          adsManager?.skip?.();

          return;
        } catch {
          /* fall through to stopping it */
        }
      }
      // Not skippable (no skipoffset in the tag): our button ends it.
      try {
        adsManager?.stop?.();
      } catch {
        /* already gone */
      }
      finish({ kind: "skipped", reason: "skip" });
    },
    toggleMute: () => {
      muted = !muted;
      try {
        adsManager?.setVolume?.(muted ? 0 : 1);
      } catch {
        /* no ad loaded */
      }
      emit({ muted });

      return muted;
    },
    destroy: () => {
      if (done) return;
      try {
        adsManager?.stop?.();
      } catch {
        /* already gone */
      }
      try {
        adsLoader?.destroy?.();
      } catch {
        /* already gone */
      }
      finish({ kind: "no_fill", reason: "destroyed" });
    },
  };
}
