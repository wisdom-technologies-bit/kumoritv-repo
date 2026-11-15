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
import {
  BASE_AD_STATE,
  type PrerollAdHandle,
  type PrerollAdState,
  type PrerollOutcome,
  type PrerollStartOptions,
} from "./preroll-engine";

export const IMA_SCRIPT_SRC = "https://imasdk.googleapis.com/js/sdkloader/ima3.js";

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

/**
 * Runs one pre-roll through IMA. IMA renders its own ad badge, countdown, skip
 * button and click-through inside our container, so `customControls` is false and
 * our overlay only contributes the "Ad" label and the mute toggle.
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
  let maxTimer = 0;
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
    window.clearTimeout(maxTimer);
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
      video?.remove();
    } catch {
      /* already gone */
    }
    video = null;
    video = null;
  };
  const finish = (outcome: Omit<PrerollOutcome, "ms">) => {
    if (done) return;
    done = true;
    cleanup();
    options.onDone({ ...outcome, ms: Date.now() - startedAt });
  };

  // Loading the SDK is the only step that can fall back to the other engine.
  try {
    await loadImaSdk(options.startTimeoutMs);
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
          adsManager = new ima.AdsManager(event.getAdsManager(), event.getAdsRequest(), {
            // Keep IMA's own UI: it owns skip timing, the countdown and the
            // click-through, which is what the tag's policy expects.
            uiElements: [
              ima.UiElements.AD_ATTRIBUTION,
              ima.UiElements.COUNTDOWN,
              ima.UiElements.SKIP,
              ima.UiElements.CLICK_THROUGH,
            ],
          });
          const rect = container.getBoundingClientRect();
          adsManager.init(
            Math.max(1, Math.round(rect.width)),
            Math.max(1, Math.round(rect.height)),
            ima.ViewMode.NORMAL,
          );
          adsManager.start();
          emit({ playing: false });

          const syncTime = () => {
            try {
              const remaining = Number(adsManager?.getRemainingTime?.());

              if (Number.isFinite(remaining)) emit({ remainingSec: Math.max(0, remaining) });
            } catch {
              /* no ad loaded */
            }
          };

          remainingTimer = window.setInterval(syncTime, 250);

          adsManager.addEventListener(ima.AdEvent.Type.STARTED, () => {
            emit({ playing: true, remainingSec: state.remainingSec ?? options.maxAdSec });
            maxTimer = window.setTimeout(() => {
              try {
                adsManager?.stop?.();
              } catch {
                /* already stopped */
              }
              finish({ kind: "skipped", reason: "ad_too_long" });
            }, options.maxAdSec * 1000);
          });
          adsManager.addEventListener(ima.AdEvent.Type.AD_PROGRESS, () => {
            syncTime();
            emit({ skippable: Boolean(adsManager?.getAdSkippableState?.()) });
          });
          adsManager.addEventListener(ima.AdEvent.Type.SKIPPABLE_STATE_CHANGED, () =>
            emit({ skippable: Boolean(adsManager?.getAdSkippableState?.()) }),
          );
          adsManager.addEventListener(ima.AdEvent.Type.SKIPPED, () =>
            finish({ kind: "skipped", reason: "skip" }),
          );
          adsManager.addEventListener(ima.AdEvent.Type.COMPLETE, () => {});
          adsManager.addEventListener(ima.AdEvent.Type.ALL_ADS_COMPLETED, () =>
            finish({ kind: "completed" }),
          );
          adsManager.addEventListener(ima.AdEvent.Type.CONTENT_PAUSE_REQUESTED, () => {});
          adsManager.addEventListener(ima.AdErrorEvent.Type.AD_ERROR, (event: ImaWindow) => {
            const code = Number(event?.getError?.()?.getErrorCode?.() ?? 900);

            finish({ kind: "error", reason: "ad_error", errorCode: Number.isFinite(code) ? code : 900 });
          });
        } catch (error) {
          finish({ kind: "error", reason: "ima_manager_error" });
        }
      },
    );
    adsLoader.addEventListener(ima.AdErrorEvent.Type.AD_ERROR, (event: ImaWindow) => {
      // No fill is not an error for the viewer: the content simply plays.
      const message = String(event?.getError?.()?.getMessage?.() || "");
      const noFill = /no ad|no ads|empty|VAST response/i.test(message);

      finish({ kind: noFill ? "no_fill" : "error", reason: noFill ? "ima_no_fill" : "ima_error" });
    });

    const request = new ima.AdsRequest();
    const rect = container.getBoundingClientRect();

    request.adTagUrl = options.adTagUrl;
    request.linearAdSlotWidth = Math.max(1, Math.round(rect.width));
    request.linearAdSlotHeight = Math.max(1, Math.round(rect.height));
    request.nonLinearAdSlotWidth = Math.max(1, Math.round(rect.width));
    request.nonLinearAdSlotHeight = Math.max(1, Math.round(Math.min(rect.height, 120)));
    adDisplayContainer.initialize();
    adsLoader.requestAds(request);

    // Nothing started within the budget: treat as no ad, never hold the viewer.
    window.setTimeout(() => {
      if (!done && !state.playing) finish({ kind: "timeout", reason: "start_timeout", errorCode: 301 });
    }, options.startTimeoutMs);
  } catch (error) {
    finish({ kind: "error", reason: "ima_setup_failed" });
  }

  return {
    skip: () => {
      try {
        if (adsManager?.getAdSkippableState?.()) adsManager.skip?.();
        else adsManager?.stop?.();
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
        /* no manager */
      }
      emit({ muted });

      return muted;
    },
    destroy: () => finish({ kind: "no_fill", reason: "destroyed" }),
  };
}
