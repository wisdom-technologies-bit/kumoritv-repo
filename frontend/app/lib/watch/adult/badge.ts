/** The corner label on the player: red for uncensored, amber for censored. */
import type { AdultVariant } from "./config";

export type VariantBadge = { label: "UNCENSORED" | "CENSORED"; tone: AdultVariant };

export function variantBadge(value: unknown): VariantBadge | null {
  if (value === "uncensored") return { label: "UNCENSORED", tone: "uncensored" };
  if (value === "censored") return { label: "CENSORED", tone: "censored" };
  return null;
}
