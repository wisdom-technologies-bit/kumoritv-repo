"use client";

// Watches one YouTube trailer iframe and reports back when it is not playing,
// so the caller can drop the iframe and leave the artwork alone.
//
// Three failure shapes are covered because YouTube uses all three:
// - a refused video answers `onError` with 101 / 150 / 153,
// - the error-153 "video player configuration error" page answers *nothing at
//   all*, so silence past the timeout also counts as a failure,
// - an embedding-disabled or region-blocked video answers `onReady` and then
//   sits on a "Video unavailable" screen, so a live player alone is not proof:
//   only a playable `playerState` within the timeout keeps the frame.

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  isPlayablePlayerState,
  parseYoutubePlayerMessage,
} from "@/app/lib/youtube";

/** A player that is not playing the video by now never will. */
export const TRAILER_READY_TIMEOUT_MS = 8000;

// Module scope on purpose: a slide that failed once stays failed for the rest
// of the session, so swiping back and forth does not retry (and re-flash) it.
const failedTrailerIds = new Set<string>();

export function hasTrailerFailed(id: string | null | undefined): boolean {
  return !!id && failedTrailerIds.has(id);
}

/** Test helper: forget the session's failures. */
export function resetFailedTrailers(): void {
  failedTrailerIds.clear();
}

export type TrailerGuard = {
  /** True once the embed is known to be broken; render nothing. */
  failed: boolean;
  /** Attach to the iframe so the handshake reaches the right frame. */
  frameRef: RefObject<HTMLIFrameElement>;
  /** Call from the iframe's onLoad. */
  onFrameLoad: () => void;
};

export type TrailerGuardOptions = {
  /** How long the player gets to prove it can play the video. */
  timeoutMs?: number;
  /**
   * Only autoplaying embeds have to prove playback. A click-to-play embed
   * (the banner, /media/[id]) legitimately sits on its poster frame until the
   * visitor presses play, so for those only a refusal removes the frame.
   */
  requirePlayback?: boolean;
};

/** The player stays silent until it is told the page is listening. */
function sendListening(target: Window | null | undefined): void {
  try {
    // The target origin must be YouTube's, never "*".
    target?.postMessage(
      JSON.stringify({ event: "listening", id: "kumori-trailer" }),
      "https://www.youtube.com"
    );
  } catch {
    // A frame that is already gone needs no handshake.
  }
}

export function useYoutubeTrailerGuard(
  trailerId: string | null,
  {
    timeoutMs = TRAILER_READY_TIMEOUT_MS,
    requirePlayback = true,
  }: TrailerGuardOptions = {}
): TrailerGuard {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [failed, setFailed] = useState<boolean>(() => hasTrailerFailed(trailerId));

  useEffect(() => {
    if (!trailerId) {
      setFailed(false);
      return;
    }

    if (hasTrailerFailed(trailerId)) {
      setFailed(true);
      return;
    }

    setFailed(false);

    let playing = false;
    let finished = false;

    const fail = (reason: string) => {
      if (finished) return;
      finished = true;
      clearInterval(handshake);
      failedTrailerIds.add(trailerId);
      setFailed(true);
      // One short line, no ids beyond the video and no internals.
      console.warn(`[trailer] ${reason}, showing the artwork instead`);
    };

    const timer = requirePlayback
      ? setTimeout(() => {
          if (!playing) fail("the video never started playing");
        }, timeoutMs)
      : undefined;

    // The handshake races the player's own script: an `onLoad` message can be
    // sent before the player is listening for it, and then no `infoDelivery`
    // ever arrives even though the video plays. Repeating it is free.
    const handshake = setInterval(() => {
      if (finished || playing) return;
      sendListening(frameRef.current?.contentWindow);
    }, 700);

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== "https://www.youtube.com") return;
      // Ignore players belonging to another trailer or another widget.
      if (event.source && frameRef.current?.contentWindow && event.source !== frameRef.current.contentWindow) {
        return;
      }

      const message = parseYoutubePlayerMessage(event.data);
      if (!message) return;

      if (message.kind === "error") {
        fail(
          message.code
            ? `YouTube refused this embed (error ${message.code})`
            : "YouTube refused this embed"
        );
        return;
      }

      if (isPlayablePlayerState(message.playerState)) {
        playing = true;
        if (timer) clearTimeout(timer);
        clearInterval(handshake);
      }
    };

    window.addEventListener("message", onMessage);

    return () => {
      if (timer) clearTimeout(timer);
      clearInterval(handshake);
      window.removeEventListener("message", onMessage);
    };
  }, [trailerId, timeoutMs, requirePlayback]);

  const onFrameLoad = useCallback(() => {
    sendListening(frameRef.current?.contentWindow);
  }, []);

  return { failed, frameRef, onFrameLoad };
}
