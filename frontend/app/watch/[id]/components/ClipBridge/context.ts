"use client";

// Prompt 35: the one link between the player (which owns the video element) and
// the Clip button (which lives in the toolbar, outside it).
//
// The player registers a tiny API; the button asks for the current time and the
// panel seeks/plays/pauses through it. Nothing else crosses the boundary, so the
// player keeps owning playback and the toolbar stays a toolbar.

import { createContext, useContext } from "react";

export type PlayerApi = {
  /** Seconds; 0 when the media element has no time yet. */
  getTime: () => number;
  /** Seconds; 0 when the duration is not known (yet, or ever). */
  getDuration: () => number;
  seek: (time: number) => void;
  play: () => void;
  pause: () => void;
  /** True for provider iframe embeds: no currentTime, no seek. */
  isEmbed: boolean;
  /** False while the episode has no playable source at all. */
  hasSource: boolean;
};

export type ClipBridgeValue = {
  /** Null until a clip-capable player has registered. */
  api: PlayerApi | null;
  register: (api: PlayerApi | null) => void;
  /** Time updates from the player, for the preview's stop-at-end. */
  subscribe: (listener: (time: number) => void) => () => void;
  /** The player calls this on every timeupdate. */
  emitTime: (time: number) => void;
  open: boolean;
  /** Captured at the moment the Clip button was pressed. */
  capturedStart: number;
  openClipPanel: () => void;
  closeClipPanel: () => void;
  /** Small, single-line message (also used for "Exit fullscreen to clip"). */
  toast: (message: string) => void;
};

export const ClipBridgeContext = createContext<ClipBridgeValue | null>(null);

export function useClipBridge(): ClipBridgeValue | null {
  return useContext(ClipBridgeContext);
}
