// Phase 6, part A: the shared moderation vocabulary.
import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyModerationError,
  classifyReportError,
  hiddenBannerText,
  isModerationAction,
  isModerationKind,
  moderationTargetPath,
  removedBannerText,
  validateModerationInput,
} from "@/app/lib/community/moderation";

const ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

test("kinds and actions are exactly the four the database accepts", () => {
  for (const kind of ["post", "comment", "announcement", "clip"]) assert.equal(isModerationKind(kind), true);
  for (const kind of ["profile", "user", "", null, 1]) assert.equal(isModerationKind(kind), false);

  for (const action of ["hide", "unhide", "remove", "restore"]) assert.equal(isModerationAction(action), true);
  for (const action of ["delete", "role_change", null]) assert.equal(isModerationAction(action), false);
});

test("validation trims, nulls an empty reason and rejects what the database would reject", () => {
  const ok = validateModerationInput({ kind: "post", id: ID, action: "hide", reason: "   " });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.value.reason, null);

  const parsed = validateModerationInput({ kind: "comment", id: ID, action: "remove", reason: "  spam  " });
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.value.reason, "spam");

  assert.equal(validateModerationInput(null).ok, false);
  // UUIDs are case-insensitive in Postgres, so an upper-case id is accepted.
  assert.equal(validateModerationInput({ kind: "post", id: ID.toUpperCase(), action: "hide" }).ok, true);
  assert.equal(validateModerationInput({ kind: "post", id: "3f2504e0-4f89-41d3-9a0c", action: "hide" }).ok, false);
  assert.equal(validateModerationInput({ kind: "post", id: ID, action: "remove", reason: "" }).ok, false);
  assert.equal(validateModerationInput({ kind: "post", id: ID, action: "remove", reason: "no" }).ok, false);
  assert.equal(
    validateModerationInput({ kind: "post", id: ID, action: "remove", reason: "x".repeat(301) }).ok,
    false,
  );
});

test("database error codes become typed answers, never a leaked internal", () => {
  assert.equal(classifyModerationError("community_moderate:not_staff").status, 403);
  assert.equal(classifyModerationError("community_moderate:not_found").status, 404);
  assert.equal(classifyModerationError("community_moderate:bad_kind").status, 400);
  assert.equal(classifyModerationError("community_moderate:bad_action").status, 400);
  assert.equal(classifyModerationError("community_moderate:reason_required").status, 400);

  const unknown = classifyModerationError('relation "public.community_posts" does not exist');
  assert.equal(unknown.status, 500);
  assert.doesNotMatch(unknown.message, /community_posts/);

  assert.equal(classifyReportError("community_resolve_report:not_staff").status, 403);
  assert.equal(classifyReportError("community_dismiss_reports:too_many").status, 400);
  assert.equal(classifyReportError("community_resolve_report:bad_status").status, 400);
  assert.equal(classifyReportError("community_resolve_report:not_found").status, 404);
});

test("the author banner says the same thing everywhere", () => {
  assert.equal(hiddenBannerText(), "Hidden by moderators");
  assert.equal(removedBannerText("Spam"), "Removed: Spam");
  assert.equal(removedBannerText("   "), "Removed by moderators");
  assert.equal(removedBannerText(null), "Removed by moderators");
});

test("log rows link to content only when there is something to link to", () => {
  assert.equal(moderationTargetPath("post", ID), `/community/post/${ID}`);
  assert.equal(moderationTargetPath("announcement", ID), `/community/announcements/${ID}`);
  assert.equal(moderationTargetPath("clip", ID, { clipCode: "abc2345" }), "/clip/abc2345");
  assert.equal(moderationTargetPath("clip", ID), null);
  assert.equal(moderationTargetPath("comment", ID), null);
});
