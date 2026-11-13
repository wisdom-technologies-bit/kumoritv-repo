// Prompt 38B: limits shared by the server validator and the composer UI.
//
// These live in their own module with NO imports so a client component can read
// them without dragging `bad-words` (a server-only profanity filter) into the
// browser bundle.
export const POST_BODY_MAX = 1000;
export const POST_BODY_MIN = 1;
export const COMMUNITY_COMMENT_MAX = 400;
export const REPORT_DETAILS_MAX = 500;

export const REPORT_REASONS = [
  "spam",
  "harassment",
  "spoiler",
  "inappropriate",
  "copyright",
  "other",
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];
