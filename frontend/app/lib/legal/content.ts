/**
 * Single home for the details the legal pages repeat: who runs the site, how to
 * reach us, and when the text last changed. Update here and every page and
 * footer link follows.
 */
export const LEGAL_BRAND = "KumoriTV";

/** Live domain. Read from the environment at request time so a domain change
 *  needs no code edit; the fallback is the production domain. */
export const LEGAL_SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://kumoritv.top"
).replace(/\/+$/, "");

export const LEGAL_LAST_UPDATED = "29 October 2026";
export const LEGAL_LAST_UPDATED_ISO = "2026-10-29";

/** Where privacy requests, takedowns and legal notices go. */
export const LEGAL_CONTACT_EMAIL = "support@kumoritv.top";

/** The community channel we also accept questions through. */
export const LEGAL_DISCORD_INVITE = "https://discord.gg/J8CjhJWrnu";

export const LEGAL_LINKS = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms of Service" },
] as const;
