// Prompt 41 (B): where the download dropdown goes.
//
// The toolbar row scrolls horizontally and clips its overflow, so the menu is
// rendered in a portal against the pill's viewport rect. Pure math, so the
// "stays on screen at 360px" rule is a unit test rather than a screenshot.

export type AnchorRect = { left: number; right: number; top: number; bottom: number };
export type Viewport = { width: number; height: number };
export type MenuPlacement = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  flipped: boolean;
};

export const MENU_MARGIN = 12;
export const MENU_MAX_WIDTH = 320;
export const MENU_MIN_WIDTH = 220;
export const MENU_GAP = 6;

export function placeMenu(
  anchor: AnchorRect,
  size: { width: number; height: number },
  viewport: Viewport,
  margin: number = MENU_MARGIN,
): MenuPlacement {
  const room = Math.max(200, viewport.width - margin * 2);
  const width = Math.max(
    Math.min(MENU_MIN_WIDTH, room),
    Math.min(size.width, MENU_MAX_WIDTH, room),
  );
  const left = Math.min(
    Math.max(margin, anchor.left),
    Math.max(margin, viewport.width - width - margin),
  );

  const below = viewport.height - anchor.bottom - MENU_GAP - margin;
  const above = anchor.top - MENU_GAP - margin;
  const flipped = below < Math.min(size.height, 200) && above > below;

  return {
    left: Math.round(left),
    top: Math.round(
      flipped ? Math.max(margin, anchor.top - MENU_GAP - size.height) : anchor.bottom + MENU_GAP,
    ),
    width: Math.round(width),
    maxHeight: Math.round(Math.max(160, flipped ? above : below)),
    flipped,
  };
}

/** Highest quality first; odd values like 800p keep their place. */
export function sortQualities<T extends { quality: string }>(options: T[]): T[] {
  const rank = (quality: string) => {
    const digits = quality.replace(/[^0-9]/g, "");
    return digits ? Number(digits) : 0;
  };
  return [...options].sort((a, b) => rank(b.quality) - rank(a.quality));
}
