// Phase 6, part A: the vocabulary and the validation every moderation surface
// shares.
//
// Client-safe on purpose (no server imports): the admin UI, the routes and the
// tests all read the same lists, so a reason preset cannot drift between the
// dialog and the validator. The database is still the authority: these values
// are re-checked by public.community_moderate().

export const MODERATION_KINDS = ["post", "comment", "announcement", "clip"] as const;
export type ModerationKind = (typeof MODERATION_KINDS)[number];

export const MODERATION_ACTIONS = ["hide", "unhide", "remove", "restore"] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

export type ModerationState = "published" | "hidden" | "removed";

export const MODERATION_KIND_LABELS: Record<ModerationKind, string> = {
  post: "Post",
  comment: "Comment",
  announcement: "Announcement",
  clip: "Clip",
};

export const MODERATION_ACTION_LABELS: Record<ModerationAction, string> = {
  hide: "Hide",
  unhide: "Unhide",
  remove: "Remove",
  restore: "Restore",
};

/** What each action means, in the words the handbook uses too. */
export const MODERATION_ACTION_HELP: Record<ModerationAction, string> = {
  hide: "Held back from everyone but the author and staff. Reversible.",
  unhide: "Puts a hidden item back in public view.",
  remove: "Taken down. Needs a reason; the author sees it.",
  restore: "Puts a removed item back in public view.",
};

export const REMOVE_REASON_MIN = 3;
export const REMOVE_REASON_MAX = 300;

/** The presets the Remove dialog offers. Each one is a full, readable reason. */
export const REMOVE_REASON_PRESETS = [
  { value: "spam", label: "Spam or advertising" },
  { value: "harassment", label: "Harassment or hate" },
  { value: "spoiler", label: "Untagged spoiler" },
  { value: "inappropriate", label: "Inappropriate content" },
  { value: "copyright", label: "Copyright" },
  { value: "other", label: "Something else" },
] as const;

/** The sentence a removed author reads. Kept here so every banner says the same. */
export function removedBannerText(reason: string | null | undefined): string {
  const cleaned = (reason ?? "").trim();
  return cleaned ? `Removed: ${cleaned}` : "Removed by moderators";
}

export function hiddenBannerText(): string {
  return "Hidden by moderators";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isModerationKind(value: unknown): value is ModerationKind {
  return typeof value === "string" && (MODERATION_KINDS as readonly string[]).includes(value);
}

export function isModerationAction(value: unknown): value is ModerationAction {
  return typeof value === "string" && (MODERATION_ACTIONS as readonly string[]).includes(value);
}

export type ModerationInput = {
  kind: ModerationKind;
  id: string;
  action: ModerationAction;
  reason: string | null;
};

export type ModerationValidation =
  | { ok: true; value: ModerationInput }
  | { ok: false; error: string; message: string };

/**
 * Validates a moderation request body. The reason is required for `remove`
 * only; for the other actions it is optional and, when present, length-checked
 * so a pasted essay cannot fill the log.
 */
export function validateModerationInput(raw: unknown): ModerationValidation {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "invalid_body", message: "That request could not be read." };
  }
  const body = raw as Record<string, unknown>;

  if (!isModerationKind(body.kind)) {
    return { ok: false, error: "invalid_kind", message: "That kind of content cannot be moderated." };
  }
  if (typeof body.id !== "string" || !UUID.test(body.id)) {
    return { ok: false, error: "invalid_id", message: "That content could not be found." };
  }
  if (!isModerationAction(body.action)) {
    return { ok: false, error: "invalid_action", message: "That action is not allowed." };
  }

  const rawReason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (body.action === "remove") {
    if (rawReason.length < REMOVE_REASON_MIN) {
      return { ok: false, error: "reason_required", message: "Give a short reason for the removal." };
    }
    if (rawReason.length > REMOVE_REASON_MAX) {
      return { ok: false, error: "reason_too_long", message: `Keep the reason under ${REMOVE_REASON_MAX} characters.` };
    }
  } else if (rawReason.length > REMOVE_REASON_MAX) {
    return { ok: false, error: "reason_too_long", message: `Keep the reason under ${REMOVE_REASON_MAX} characters.` };
  }

  return {
    ok: true,
    value: {
      kind: body.kind,
      id: body.id,
      action: body.action,
      reason: rawReason || null,
    },
  };
}

/**
 * Maps a database error from public.community_moderate() onto a typed HTTP
 * answer. The function raises stable codes (`community_moderate:<code>`), so a
 * message change can never silently become a 500.
 */
export function classifyModerationError(message: string): {
  status: number;
  error: string;
  message: string;
} {
  const code = /community_moderate:([a-z_]+)/.exec(message ?? "")?.[1] ?? "";

  if (code === "not_staff") {
    return { status: 403, error: "forbidden", message: "Your account cannot moderate content." };
  }
  if (code === "not_found") {
    return { status: 404, error: "not_found", message: "That content no longer exists." };
  }
  if (code === "bad_kind") {
    return { status: 400, error: "invalid_kind", message: "That kind of content cannot be moderated." };
  }
  if (code === "bad_action") {
    return { status: 400, error: "invalid_action", message: "That action is not allowed." };
  }
  if (code === "reason_required") {
    return { status: 400, error: "reason_required", message: "Give a short reason for the removal." };
  }
  if (/permission denied|row-level security/i.test(message ?? "")) {
    return { status: 403, error: "forbidden", message: "Your account cannot moderate content." };
  }
  return { status: 500, error: "moderation_failed", message: "The change could not be saved." };
}

/** Same idea for the report inbox writes. */
export function classifyReportError(message: string): {
  status: number;
  error: string;
  message: string;
} {
  const code = /community_(?:resolve_report|dismiss_reports):([a-z_]+)/.exec(message ?? "")?.[1] ?? "";
  if (code === "not_staff") {
    return { status: 403, error: "forbidden", message: "Your account cannot moderate content." };
  }
  if (code === "not_found") {
    return { status: 404, error: "not_found", message: "That report no longer exists." };
  }
  if (code === "bad_status") {
    return { status: 400, error: "invalid_status", message: "That decision is not allowed." };
  }
  if (code === "empty" || code === "too_many") {
    return {
      status: 400,
      error: "invalid_selection",
      message: "Select between 1 and 50 reports.",
    };
  }
  if (code === "note_too_long") {
    return { status: 400, error: "note_too_long", message: "Keep the note under 500 characters." };
  }
  return { status: 500, error: "report_failed", message: "That report could not be updated." };
}

/** The target URL for a log row, or null when the content is gone. */
export function moderationTargetPath(kind: string, id: string, extra?: { clipCode?: string | null }): string | null {
  if (kind === "post") return `/community/post/${id}`;
  if (kind === "announcement") return `/community/announcements/${id}`;
  if (kind === "clip") return extra?.clipCode ? `/clip/${extra.clipCode}` : null;
  return null;
}
