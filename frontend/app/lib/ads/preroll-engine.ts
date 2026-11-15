// Prompt 40: shared types for the two pre-roll engines.
//
// `ima`  - the Google IMA SDK (imasdk/ima3.js). Default: it is what Adcash's own
//          instructions use, it handles VPAID/wrapper tags and it is CORS-proof
//          because the SDK loads the tag itself.
// `vast` - our first-party VAST client. Fallback only, for when ima3.js cannot
//          load at all (blocked, offline, CSP). Plain MP4 tags only.
export type PrerollEngine = "ima" | "vast";

export type PrerollAdState = {
  engine: PrerollEngine;
  /** Invisible while the creative buffers. */
  playing: boolean;
  remainingSec: number | null;
  /** Seconds of ad playback before a skip is allowed (from the VAST skipoffset). */
  skipAfterSec: number | null;
  /** The engine will accept a skip right now. */
  skippable: boolean;
  /** True when the engine has no UI of its own, so ours must render skip/mute/click. */
  customControls: boolean;
  muted: boolean;
  clickThrough: string | null;
};

export type PrerollOutcomeKind = "completed" | "skipped" | "no_fill" | "error" | "timeout";

export type PrerollOutcome = {
  kind: PrerollOutcomeKind;
  reason?: string;
  ms: number;
  /** VAST error code, when the failure maps to one. */
  errorCode?: number;
};

export type PrerollAdHandle = {
  skip: () => void;
  toggleMute: () => boolean;
  destroy: () => void;
  /** The engine failed before any ad: the caller may try the other engine. */
  fellBack?: boolean;
};

export type PrerollStartOptions = {
  container: HTMLElement;
  adTagUrl: string;
  skipAfterSec: number;
  maxAdSec: number;
  startTimeoutMs: number;
  vastTimeoutMs: number;
  onState: (state: PrerollAdState) => void;
  onDone: (outcome: PrerollOutcome) => void;
};

export const BASE_AD_STATE: Omit<PrerollAdState, "engine"> = {
  playing: false,
  remainingSec: null,
  skipAfterSec: null,
  skippable: false,
  customControls: false,
  muted: false,
  clickThrough: null,
};

/**
 * The skip control's state, in one place: our own button waits `skipAfterSec` of
 * AD playback (engine time), while an engine with its own UI (IMA) reports when
 * its native skip is ready.
 */
export function prerollSkipUi(
  state: Pick<PrerollAdState, "customControls" | "skippable" | "skipAfterSec">,
  elapsedSec: number,
  fallbackAfterSec: number,
) {
  const after = state.skipAfterSec ?? fallbackAfterSec;
  const canSkip = state.customControls ? elapsedSec >= after : Boolean(state.skippable);
  const skipIn = Math.max(0, Math.ceil(after - elapsedSec));

  return { canSkip, skipIn, label: canSkip ? "Skip ad" : `Skip in ${skipIn}` };
}
