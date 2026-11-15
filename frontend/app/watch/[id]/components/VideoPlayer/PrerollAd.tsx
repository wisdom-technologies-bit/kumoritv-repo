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
  readPrerollStore,
  recordPrerollCount,
  registerPrerollFailure,
  registerPrerollSuccess,
  writePrerollAdShown,
  writePrerollBreaker,
} from "@/app/lib/ads/preroll";
import {
  BASE_AD_STATE,
  prerollSkipUi,
  type PrerollAdHandle,
  type PrerollAdState,
  type PrerollOutcome,
} from "@/app/lib/ads/preroll-engine";
import { startImaPreroll } from "@/app/lib/ads/preroll-ima";
import { openAdvertiser, startVastPreroll } from "@/app/lib/ads/preroll-vast";
import styles from "./preroll.module.css";

type Props = {
  vastUrl: string;
  skipAfterSec: number;
  maxAdSec: number;
  startTimeoutMs: number;
  vastTimeoutMs: number;
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
  autoplay = false,
  onFinished,
  startEngine = defaultEngineStart,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<PrerollAdHandle | null>(null);
  const finishedRef = useRef(false);
  const skipButtonRef = useRef<HTMLButtonElement | null>(null);
  const [ad, setAd] = useState<PrerollAdState>({ ...BASE_AD_STATE, engine: "ima", skipAfterSec });
  const [elapsed, setElapsed] = useState(0);

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
      } else {
        recordPrerollCount("errored", outcome.reason);
        writePrerollBreaker(registerPrerollFailure(store.breaker, Date.now()));
      }
      logPrerollOutcome({ kind: outcome.kind, reason: outcome.reason, ms: outcome.ms });
      void PREROLL_BREAKER_FAILURES;
      onFinished(outcome);
    },
    [autoplay, onFinished],
  );

  // ---------------------------------------------------------------- engine
  useEffect(() => {
    const container = containerRef.current;

    if (!container) return undefined;

    let cancelled = false;
    recordPrerollCount("requests");

    const options = {
      container,
      adTagUrl: vastUrl,
      skipAfterSec,
      maxAdSec,
      startTimeoutMs,
      vastTimeoutMs,
      onState: (state: PrerollAdState) => {
        if (!cancelled) setAd(state);
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
    const hardStop = window.setTimeout(
      () => finish({ kind: "timeout", reason: "hard_timeout", ms: startTimeoutMs + vastTimeoutMs + 2000 }),
      startTimeoutMs + vastTimeoutMs + 2000,
    );

    return () => {
      cancelled = true;
      window.clearTimeout(hardStop);
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
    <div className={styles.layer} data-preroll-engine={ad.engine} role="group" aria-label="Advertisement">
      <div className={styles.ad_container} ref={containerRef} />
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
        {ad.customControls && (
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
      {!ad.playing && (
        <p className={styles.loading} role="status">
          Loading ad…
        </p>
      )}
    </div>
  );
}
