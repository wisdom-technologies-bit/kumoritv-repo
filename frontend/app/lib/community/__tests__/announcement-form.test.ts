// Phase 4, part B2: the rules the composer and the API both obey.

import assert from "node:assert/strict";
import test from "node:test";
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_TITLE_MAX,
  announcementPlainText,
  announcementStatus,
  safeHttpsUrl,
  validateAnnouncementInput,
} from "@/app/lib/community/announcement-form";
import { insertMarkdown } from "@/app/lib/community/markdown-insert";

const NOW = Date.parse("2026-11-17T12:00:00.000Z");

function input(overrides: Record<string, unknown> = {}) {
  return {
    title: "Service Update",
    body: "# We are back\n\nThank you.",
    image: null,
    url: null,
    expiresAt: null,
    sendPush: true,
    ...overrides,
  };
}

test("a valid announcement passes and is normalised", () => {
  const result = validateAnnouncementInput(input({ title: "  Service Update  " }), NOW);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.title, "Service Update");
    assert.equal(result.value.sendPush, true);
  }
});

test("title and body are required", () => {
  const noTitle = validateAnnouncementInput(input({ title: "   " }), NOW);
  assert.equal(noTitle.ok, false);
  if (!noTitle.ok) assert.equal(noTitle.field, "title");

  const noBody = validateAnnouncementInput(input({ body: "" }), NOW);
  assert.equal(noBody.ok, false);
  if (!noBody.ok) assert.equal(noBody.field, "body");
});

test("lengths are capped on the server, not just by maxLength", () => {
  const longTitle = validateAnnouncementInput(input({ title: "a".repeat(ANNOUNCEMENT_TITLE_MAX + 1) }), NOW);
  assert.equal(longTitle.ok, false);

  const longBody = validateAnnouncementInput(input({ body: "a".repeat(ANNOUNCEMENT_BODY_MAX + 1) }), NOW);
  assert.equal(longBody.ok, false);
});

test("an unknown field is rejected, not ignored", () => {
  const result = validateAnnouncementInput(input({ pinned: true }), NOW);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.field, "pinned");
    assert.match(result.message, /Unknown field/);
  }
});

test("image and url must be https", () => {
  for (const field of ["image", "url"] as const) {
    const http = validateAnnouncementInput(input({ [field]: "http://kumoritv.top/a.png" }), NOW);
    assert.equal(http.ok, false, `${field} http`);
    const js = validateAnnouncementInput(input({ [field]: "javascript:alert(1)" }), NOW);
    assert.equal(js.ok, false, `${field} javascript`);
    const ok = validateAnnouncementInput(input({ [field]: "https://kumoritv.top/a.png" }), NOW);
    assert.equal(ok.ok, true, `${field} https`);
  }
});

test("empty strings for the optional fields mean null", () => {
  const result = validateAnnouncementInput(input({ image: "", url: "", expiresAt: "" }), NOW);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.image, null);
    assert.equal(result.value.url, null);
    assert.equal(result.value.expiresAt, null);
  }
});

test("expiry must be a real future instant, stored as UTC", () => {
  const past = validateAnnouncementInput(input({ expiresAt: "2020-01-01T00:00:00.000Z" }), NOW);
  assert.equal(past.ok, false);
  if (!past.ok) assert.equal(past.field, "expiresAt");

  const bad = validateAnnouncementInput(input({ expiresAt: "next tuesday" }), NOW);
  assert.equal(bad.ok, false);

  const future = validateAnnouncementInput(input({ expiresAt: "2026-12-01T09:30:00+01:00" }), NOW);
  assert.equal(future.ok, true);
  if (future.ok) assert.equal(future.value.expiresAt, "2026-12-01T08:30:00.000Z");
});

test("sendPush must be a boolean, and defaults to true", () => {
  const missing = validateAnnouncementInput(
    { title: "t", body: "b" },
    NOW,
  );
  assert.equal(missing.ok, true);
  if (missing.ok) assert.equal(missing.value.sendPush, true);

  const bad = validateAnnouncementInput(input({ sendPush: "yes" }), NOW);
  assert.equal(bad.ok, false);
});

test("the idempotency key must be a UUID when present", () => {
  const bad = validateAnnouncementInput(input({ idempotencyKey: "abc" }), NOW);
  assert.equal(bad.ok, false);
  const good = validateAnnouncementInput(
    input({ idempotencyKey: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" }),
    NOW,
  );
  assert.equal(good.ok, true);
});

test("the push body is the plain projection, cut at 140 at a word boundary", () => {
  const body = `# Title\n\n${"word ".repeat(60)}`;
  const plain = announcementPlainText(body, 140);
  assert.equal(plain.includes("#"), false);
  assert.ok(plain.length <= 141, String(plain.length));
  assert.ok(plain.endsWith("…"));
});

test("status is active until the expiry instant, then expired", () => {
  assert.equal(announcementStatus(null, NOW), "active");
  assert.equal(announcementStatus("2026-11-17T12:00:01.000Z", NOW), "active");
  assert.equal(announcementStatus("2026-11-17T11:59:59.000Z", NOW), "expired");
});

test("safeHttpsUrl trims, validates and normalises", () => {
  assert.equal(safeHttpsUrl(""), null);
  assert.equal(safeHttpsUrl("  https://kumoritv.top/a  "), "https://kumoritv.top/a");
  assert.equal(safeHttpsUrl("http://kumoritv.top"), false);
  assert.equal(safeHttpsUrl("not a url"), false);
});

/* -------------------------------- toolbar -------------------------------- */

test("bold wraps the selection and keeps it selected", () => {
  const result = insertMarkdown("hello world", 6, 11, "bold");
  assert.equal(result.value, "hello **world**");
  assert.equal(result.value.slice(result.selectionStart, result.selectionEnd), "world");
});

test("bold with nothing selected inserts a placeholder", () => {
  const result = insertMarkdown("", 0, 0, "bold");
  assert.equal(result.value, "**bold text**");
});

test("a link becomes [text](url) with the url selected", () => {
  const result = insertMarkdown("read this", 0, 9, "link");
  assert.equal(result.value, "[read this](https://)");
  assert.equal(result.value.slice(result.selectionStart, result.selectionEnd), "https://");
});

test("heading, list and quote insert at the cursor, on their own line", () => {
  const heading = insertMarkdown("intro", 5, 5, "heading");
  assert.equal(heading.value, "intro\n\n## Heading");

  const list = insertMarkdown("", 0, 0, "list");
  assert.equal(list.value, "- List item");

  const quote = insertMarkdown("a\n", 2, 2, "quote");
  assert.equal(quote.value, "a\n> Quote");
});

test("the toolbar never loses text around the selection", () => {
  const result = insertMarkdown("alpha beta gamma", 6, 10, "italic");
  assert.equal(result.value, "alpha *beta* gamma");
});
