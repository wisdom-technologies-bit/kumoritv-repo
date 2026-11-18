// Part B: the announcement preview.
//
// The rule under test is one sentence: the SOURCE is cut at a word boundary at
// ~320 characters and at most 6 lines BEFORE Markdown is parsed, the rendered
// box is clamped by CSS, and "Read more" appears exactly when something was cut.
// Every payload that used to reach the feed as raw text is here.

import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { render } from "../../../../test-harness/render";
import AnnouncementMarkdown from "@/app/lib/community/markdown";
import { preparePreview, PREVIEW_MAX_CHARS } from "@/app/lib/community/preview";

const SAMPLE = [
  "# Service Update: KumoriTV Is Back Online!",
  "",
  "We are pleased to announce that **KumoriTV is fully accessible again!**",
  "",
  "- Search works",
  "- The watch page plays",
  "",
  "> Thank you for staying with us.",
  "",
  "Read the details at [the status page](https://kumoritv.top/status) or keep watching.",
  "",
  "**We're back. Happy watching!**",
  "",
  "*The KumoriTV Team*",
].join("\n");

function textOf(container: HTMLElement): string {
  return (container.textContent ?? "").replace(/\s+/g, " ").trim();
}

test("the sample is cut at a word boundary, and the cut is reported", () => {
  const preview = preparePreview(SAMPLE);
  assert.equal(preview.cut, true);
  assert.ok(preview.text.length <= PREVIEW_MAX_CHARS + 1, String(preview.text.length));
  assert.equal(preview.text.endsWith(" "), false);
  assert.ok(SAMPLE.startsWith(preview.text.slice(0, 40)));
});

test("a 5,000-character body is cut long before the card can overflow", () => {
  const body = Array.from({ length: 60 }, (_, i) => `Paragraph ${i} ${"lorem ipsum dolor sit amet ".repeat(4)}`).join("\n\n");
  assert.ok(body.length > 5000);
  const preview = preparePreview(body);
  assert.equal(preview.cut, true);
  assert.ok(preview.text.length <= PREVIEW_MAX_CHARS + 1, String(preview.text.length));
});

test("at most six source lines survive, whatever their length", () => {
  const body = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
  const preview = preparePreview(body);
  assert.equal(preview.text.split("\n").length, 6);
  assert.equal(preview.cut, true);
});

test("the preview renders no raw heading marker and no raw emphasis", async () => {
  const tree = await render(<AnnouncementMarkdown body={SAMPLE} variant="preview" />);
  const text = textOf(tree.container);
  assert.equal(text.includes("#"), false, text);
  assert.equal(text.includes("**"), false, text);
  assert.equal(text.includes("]("), false, text);
  assert.ok(tree.container.querySelector("strong"), "bold survives as bold");
  assert.equal(tree.container.querySelector("h1"), null, "a preview never renders a heading");
  assert.equal(tree.container.querySelector("ul"), null, "lists are flattened");
  assert.equal(tree.container.querySelector("li"), null);
  assert.equal(tree.container.querySelector("blockquote"), null);
  assert.equal(tree.container.querySelector("hr"), null);
});

test("a <script> and a javascript: link are inert in the preview", async () => {
  const body = '<script>alert("xss")</script> Plain words. [click me](javascript:alert(1)) <img src=x onerror=alert(1)>';
  const tree = await render(<AnnouncementMarkdown body={body} variant="preview" />);
  assert.equal(tree.container.querySelector("script"), null);
  assert.equal(tree.container.querySelector("img"), null);
  const anchors = Array.from(tree.container.querySelectorAll("a"));
  assert.equal(anchors.some((a) => (a.getAttribute("href") ?? "").startsWith("javascript:")), false);
  assert.ok(textOf(tree.container).includes("Plain words"));
});

test("an unterminated ** never prints the stars", async () => {
  const body = "**This opening marker is never closed and the sentence keeps going well past the cut point, so the preview has to repair it instead of printing raw stars in a feed card.";
  const preview = preparePreview(body);
  assert.equal(preview.text.includes("**"), false, preview.text);
  const tree = await render(<AnnouncementMarkdown body={body} variant="preview" />);
  assert.equal(textOf(tree.container).includes("**"), false);
});

test("a body that is only an enormous URL becomes a plain, unlinked snippet", async () => {
  const body = `https://kumoritv.top/${"x".repeat(600)}`;
  const preview = preparePreview(body);
  assert.equal(preview.plain, true);
  assert.equal(preview.cut, true);
  assert.ok(preview.text.length <= PREVIEW_MAX_CHARS + 1);

  const tree = await render(<AnnouncementMarkdown body={body} variant="preview" />);
  assert.equal(tree.container.querySelectorAll("a").length, 0);
});

test("an empty body has nothing to render and nothing to cut", () => {
  assert.deepEqual(preparePreview(""), { text: "", cut: false, plain: false });
  assert.deepEqual(preparePreview(null), { text: "", cut: false, plain: false });
  assert.deepEqual(preparePreview("   \n\n "), { text: "", cut: false, plain: false });
});

test("a short body is rendered complete and is not marked as cut", () => {
  const preview = preparePreview("A short note with **bold** text.");
  assert.equal(preview.cut, false);
  assert.equal(preview.text, "A short note with **bold** text.");
});

test("links={false} never creates an anchor (no <a> inside <a>)", async () => {
  const body = "Read [the status page](https://kumoritv.top/status) for more.";
  const tree = await render(
    <a href="/community/announcements/1">
      <AnnouncementMarkdown body={body} variant="preview" links={false} />
    </a>,
  );
  assert.equal(tree.container.querySelectorAll("a a").length, 0);
  assert.equal(tree.container.querySelectorAll("a").length, 1, "only the wrapping link");
});

test("links stay clickable in the card preview, external ones hardened", async () => {
  const tree = await render(
    <AnnouncementMarkdown body="Read [the status page](https://kumoritv.top/status)." variant="preview" />,
  );
  const anchor = tree.container.querySelector("a");
  assert.ok(anchor);
  assert.equal(anchor?.getAttribute("href"), "https://kumoritv.top/status");
  assert.equal(anchor?.getAttribute("rel"), "noopener noreferrer nofollow ugc");
  assert.equal(tree.container.querySelectorAll("a a").length, 0);
});
