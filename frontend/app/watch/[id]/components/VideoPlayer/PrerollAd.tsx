"use client";

// Prompt 40: the pre-roll overlay, rendered INSIDE <MediaPlayer> so it stacks with
// the skip pill and the end card and works in fullscreen.
//
// Engine order: IMA first (Adcash's own instructions, VPAID-safe, no CORS), then
// our own VAST client only if ima3.js cannot load. Any failure ends the overlay
// and the caller starts the content - the ad can never block the episode.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  PREROLL_BREAKER_FAILURES,
  logPrerollOutcome,
  prerollDebug,
  prerollHardStopMs,
  prerollNoFillUntil,
  readPrerollStore,
  recordPrerollCount,
  registerPrerollFailure,
  registerPrerollSuccess,
  writePrerollAdShown,
  writePrerollBreaker,
  writePrerollNoFill,
} from "@/app/lib/ads/preroll";
import {
  BASE_AD_STATE,
  prerollSkipUi,
  type PrerollAdHandle,
  type PrerollAdState,
  type PrerollOutcome,
} from "@/app/lib/ads/preroll-engine";
import { primeAdRequestContext } from "@/app/lib/ads/ad-request";
import { startImaPreroll } from "@/app/lib/ads/preroll-ima";
import { openAdvertiser, startVastPreroll } from "@/app/lib/ads/preroll-vast";
import styles from "./preroll.module.css";

type Props = {
  vastUrl: string;
  skipAfterSec: number;
  maxAdSec: number;
  startTimeoutMs: number;
  vastTimeoutMs: number;
  /** Minutes to stay quiet after a no-fill (0 = never stay quiet). */
  noFillCooldownMin?: number;
  /** The previous pre-roll belongs to an auto-next play: remembered separately. */
  autoplay?: boolean;
  onFinished: (outcome: PrerollOutcome) => void;
  /**
   * The engine chain, injectable so the component tests can drive events without
   * loading a third-party SDK. Defaults to IMA, then our VAST client.
   */
  startEngine?: typeof startImaPreroll | ((options: any) => Promise<PrerollAdHandle>);
};

/** IMA first, our VAST client only when ima3.js itself cannot load. */
export async function defaultEngineStart(options: any): Promise<PrerollAdHandle> {
  try {
    return await startImaPreroll(options);
  } catch {
    logPrerollOutcome({ kind: "fallback", reason: "ima_unavailable", ms: 0 });

    return startVastPreroll(options);
  }
}

export default function PrerollAd({
  vastUrl,
  skipAfterSec,
  maxAdSec,
  startTimeoutMs,
  vastTimeoutMs,
  noFillCooldownMin = 10,
  autoplay = false,
  onFinished,
  startEngine = defaultEngineStart,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<PrerollAdHandle | null>(null);
  const finishedRef = useRef(false);
  // Prompt 42: the hard stop is a START budget. Once the creative plays, the ad's
  // own length (and the engine's cap) governs - this flag is what tells them apart.
  const playingRef = useRef(false);
  const skipButtonRef = useRef<HTMLButtonElement | null>(null);
  const [ad, setAd] = useState<PrerollAdState>({ ...BASE_AD_STATE, engine: "ima", skipAfterSec });
  const [elapsed, setElapsed] = useState(0);
  const cooldown = noFillCooldownMin;

  /** ONE exit path for every outcome: counters, breaker, one log line, then content. */
  const finish = useCallback(
    (outcome: PrerollOutcome) => {
      if (finishedRef.current) return;
      finishedRef.current = true;

      const store = readPrerollStore();
      const played = outcome.kind === "completed" || outcome.kind === "skipped";

      if (played) {
        // The interval cap only counts ads that actually played.
        recordPrerollCount("started");
        recordPrerollCount(outcome.kind === "completed" ? "completed" : "skipped", outcome.reason);
        writePrerollAdShown(Date.now(), { autoplay });
        writePrerollBreaker(registerPrerollSuccess());
      } else if (outcome.kind === "no_fill") {
        recordPrerollCount("noFill", outcome.reason);
        // Prompt 41: Adcash has no inventory right now. Remember it so the next
        // episodes do not each pay the same wait.
        writePrerollNoFill(prerollNoFillUntil({ noFillCooldownMin: cooldown } as any, Date.now()));
        prerollDebug("no_fill", `${outcome.reason || "-"} cooldown=${cooldown}min`);
      } else {
        recordPrerollCount("errored", outcome.reason);
        writePrerollBreaker(registerPrerollFailure(store.breaker, Date.now()));
      }
      logPrerollOutcome({ kind: outcome.kind, reason: outcome.reason, ms: outcome.ms });
      prerollDebug(`outcome:${outcome.kind}`, `${outcome.reason || "-"} ${outcome.ms}ms`);
      void PREROLL_BREAKER_FAILURES;
      onFinished(outcome);
    },
    [autoplay, cooldown, onFinished],
  );

  // ---------------------------------------------------------------- engine
  useEffect(() => {
    const container = containerRef.current;

    if (!container) return undefined;

    let cancelled = false;
    recordPrerollCount("requests");
    prerollDebug("request", "engine=ima-first");
    // The ad request carries the viewer's platform/browser details; priming costs
    // nothing when the player already did it before the Play tap.
    void primeAdRequestContext().catch(() => null);

    const options = {
      container,
      adTagUrl: vastUrl,
      skipAfterSec,
      maxAdSec,
      startTimeoutMs,
      vastTimeoutMs,
      onState: (state: PrerollAdState) => {
        if (cancelled) return;
        if (state.playing && !ad.playing) prerollDebug("ad_started");
        if (state.skippable && !ad.skippable) prerollDebug("skippable");
        playingRef.current = state.playing;
        setAd(state);
      },
      onDone: (outcome: PrerollOutcome) => {
        if (!cancelled) finish(outcome);
      },
    };

    void (async () => {
      try {
        const handle = await startEngine(options);

        if (cancelled) {
          handle.destroy();

          return;
        }
        handleRef.current = handle;
      } catch {
        finish({ kind: "error", reason: "engine_failed", ms: 0 });
      }
    })();

    // Hard stop: engine start + tag load + creative start, plus slack. An ad that
    // has not finished by then is "no ad".
    // Prompt 41: start + tag, capped at 8s. Was start + tag + 2s (12s with the
    // old defaults), which is why a known-empty tag looked like a stuck overlay.
    const budget = prerollHardStopMs({ startTimeoutMs, vastTimeoutMs });
    let watchdog = 0;
    const hardStop = window.setTimeout(() => {
      // Prompt 42: an ad that is already playing is never cut off here. Before,
      // this 8s timer ended every ad mid-creative, so a 15-30s fill looked like a
      // 8s ad and the content jumped in over it.
      if (playingRef.current) {
        // The creative is running, so the only thing worth guarding is a stall:
        // its own length plus slack, after which the episode is let through.
        watchdog = window.setTimeout(
          () => finish({ kind: "timeout", reason: "ad_stalled", ms: budget }),
          Math.max(5000, (Number(maxAdSec) || 0) * 1000 + 5000),
        );

        return;
      }
      finish({ kind: "timeout", reason: "hard_timeout", ms: budget });
    }, budget);

    return () => {
      cancelled = true;
      window.clearTimeout(hardStop);
      window.clearTimeout(watchdog);
      handleRef.current?.destroy();
      handleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Elapsed ad seconds drive the "Skip in N" countdown (the tag's skipoffset is
  // in ad seconds, not in remaining time).
  useEffect(() => {
    if (!ad.playing) return undefined;
    const startedAt = Date.now() - elapsed * 1000;
    const interval = window.setInterval(() => setElapsed((Date.now() - startedAt) / 1000), 250);

    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ad.playing]);

  const { canSkip, skipIn, label: skipLabel } = prerollSkipUi(ad, elapsed, skipAfterSec);

  // Keyboard: the ad owns keys while it is visible, so space/arrows cannot reach
  // the content player underneath.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key;

      if ([" ", "Enter", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "k", "m", "f"].includes(key)) {
        event.stopPropagation();
        event.preventDefault?.();
      }
      if ((key === " " || key === "Enter") && canSkip) handleRef.current?.skip();
      if (key === "m" || key === "M") handleRef.current?.toggleMute();
    };

    window.addEventListener("keydown", onKeyDown, true);

    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [canSkip]);

  useEffect(() => {
    if (canSkip) skipButtonRef.current?.focus({ preventScroll: true });
  }, [canSkip]);

  const visit = () => {
    if (!ad.clickThrough) return;
    // Pause first: the viewer is leaving the tab, and the ad must not run on.
    handleRef.current?.toggleMute();
    handleRef.current?.toggleMute();
    openAdvertiser(ad.clickThrough);
  };

  const remaining = ad.remainingSec == null ? null : Math.max(0, Math.ceil(ad.remainingSec));

  return (
    <div
      className={styles.layer}
      data-preroll-engine={ad.engine}
      data-preroll-phase={ad.playing ? "playing" : "loading"}
      role="group"
      aria-label="Advertisement"
    >
      <div className={styles.ad_container} ref={containerRef} />

      {!ad.playing && (
        // Prompt 41: a known-empty tag must not show "Loading ad…" for 12s. A black
        // cover and a neutral spinner, plus one polite line for screen readers.
        <div className={styles.cover} data-preroll-cover>
          <span className={styles.spinner} aria-hidden="true" />
          <p className={styles.sr_only} role="status" aria-live="polite">
            Loading
          </p>
        </div>
      )}

      {ad.playing && (
        <>
          <div className={styles.chrome}>
            <span className={styles.badge}>Ad</span>
            {remaining != null && (
              <span className={styles.count} aria-live="off">
                {canSkip ? `${remaining}s` : `Ad ends in ${remaining}s`}
              </span>
            )}
          </div>
          <div className={styles.actions}>
            {ad.clickThrough && (
              <button type="button" className={styles.action} onClick={visit}>
                Visit advertiser
              </button>
            )}
            <button
              type="button"
              className={styles.action}
              aria-pressed={ad.muted}
              aria-label={ad.muted ? "Unmute ad" : "Mute ad"}
              onClick={() => handleRef.current?.toggleMute()}
            >
              {ad.muted ? "Unmute" : "Mute"}
            </button>
            {(ad.customControls || ad.localSkip) && (
              <button
                ref={skipButtonRef}
                type="button"
                className={styles.skip}
                aria-label="Skip ad"
                disabled={!canSkip}
                onClick={() => handleRef.current?.skip()}
              >
                {skipLabel}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
