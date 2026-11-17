// One toast layer, two owners.
//
// The clip editor already had a small status toast (ClipBridge) before the
// community bar existed. Duplicating that surface would have meant two fixed
// elements in the same corner, overlapping on the watch page. Instead both
// register here, and the community toast waits while a clip status message is
// on screen ("the existing clip toast wins").
//
// Deliberately tiny and dependency free: a module-level owner plus subscribers,
// which is all two components need. The timer stays in each component.

export type ToastOwner = "clip" | "community";

let activeOwner: ToastOwner | null = null;
const listeners = new Set<(owner: ToastOwner | null) => void>();

function emit(): void {
  for (const listener of listeners) listener(activeOwner);
}

/** Claim the layer. A claim replaces an older one from the same owner. */
export function claimToast(owner: ToastOwner): void {
  if (activeOwner === owner) return;
  activeOwner = owner;
  emit();
}

/** Release only your own claim; never clear someone else's. */
export function releaseToast(owner: ToastOwner): void {
  if (activeOwner !== owner) return;
  activeOwner = null;
  emit();
}

export function activeToastOwner(): ToastOwner | null {
  return activeOwner;
}

/** True when the layer belongs to someone else. */
export function isToastBlocked(owner: ToastOwner): boolean {
  return activeOwner !== null && activeOwner !== owner;
}

export function subscribeToastOwner(listener: (owner: ToastOwner | null) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tests only: start from a clean layer. */
export function __resetToastCoordinator(): void {
  activeOwner = null;
  emit();
}
