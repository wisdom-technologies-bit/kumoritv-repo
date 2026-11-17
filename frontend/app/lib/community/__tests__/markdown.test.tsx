// Phase 4, part B1: the renderer, and what it refuses to do.
//
// The payloads below are the ones that matter: the owner's real sample, a raw
// <script>, an <img onerror>, a javascript: link, an unbroken URL and an empty
// body. react-markdown without rehype-raw can only ever produce React elements,
// never an HTML string, and these tests pin that down.

import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { render } from "../../../../test-harness/render";
import AnnouncementMarkdown, { safeHref } from "@/app/lib/community/markdown";

const SAMPLE = `# Service Update: KumoriTV Is Back Online!

We are pleased to announce that **KumoriTV is fully accessible again!**

The temporary service disruption has been resolved, and our website is back up and running.

We sincerely apologise for the inconvenience ... Thank you for staying with us.

**We're back. Happy watching!**

*The KumoriTV Team*
https://kumoritv.top`;

test("the owner's sample renders: one demoted heading, bold, italic, autolink", async () => {
  const tree = await render(<AnnouncementMarkdown body={SAMPLE} />);
  const html = tree.container.innerHTML;

  // A body `#` becomes an h2 so the page keeps its single h1 (the title).
  const h2 = tree.container.querySelector("h2");
  assert.ok(h2, "the heading is rendered");
  assert.equal(h2?.textContent, "Service Update: KumoriTV Is Back Online!");
  assert.equal(tree.container.querySelector("h1"), null, "the body never renders an h1");

  assert.ok(tree.container.querySelector("strong"));
  assert.ok(tree.container.querySelector("em"));
  assert.ok(html.includes("KumoriTV is fully accessible again!"));

  // remark-gfm turns the bare URL into a link.
  const links = Array.from(tree.container.querySelectorAll("a"));
  assert.ok(links.some((link) => link.getAttribute("href") === "https://kumoritv.top"));
  await tree.unmount();
});

test("a raw <script> is never executed and never becomes an element", async () => {
  const tree = await render(
    <AnnouncementMarkdown body={"hello\n\n<script>window.__pwned = 1;</script>\n\nbye"} />,
  );
  assert.equal(tree.container.querySelector("script"), null);
  assert.equal((globalThis as { __pwned?: number }).__pwned, undefined);
  assert.ok((tree.container.textContent ?? "").includes("hello"));
  await tree.unmount();
});

test("an <img onerror> is not rendered at all", async () => {
  const tree = await render(
    <AnnouncementMarkdown body={'<img src=x onerror="window.__pwned2=1">after'} />,
  );
  assert.equal(tree.container.querySelectorAll("img").length, 0);
  assert.equal((globalThis as { __pwned2?: number }).__pwned2, undefined);
  await tree.unmount();
});

test("a javascript: link loses its href but keeps its words", async () => {
  const tree = await render(<AnnouncementMarkdown body={"[x](javascript:alert(1))"} />);
  const anchors = Array.from(tree.container.querySelectorAll("a"));
  assert.equal(
    anchors.some((link) => (link.getAttribute("href") ?? "").toLowerCase().startsWith("javascript:")),
    false,
  );
  assert.ok((tree.container.textContent ?? "").includes("x"));
  await tree.unmount();
});

test("a data: image in the body is not rendered (use the image field)", async () => {
  const tree = await render(<AnnouncementMarkdown body={"![alt](data:image/png;base64,AAAA)"} />);
  assert.equal(tree.container.querySelectorAll("img").length, 0);
  await tree.unmount();
});

test("external links open safely, in a new tab", async () => {
  const tree = await render(<AnnouncementMarkdown body={"[KumoriTV](https://kumoritv.top/x)"} />);
  const link = tree.container.querySelector("a");
  assert.ok(link);
  assert.equal(link?.getAttribute("href"), "https://kumoritv.top/x");
  assert.equal(link?.getAttribute("target"), "_blank");
  assert.equal(link?.getAttribute("rel"), "noopener noreferrer nofollow ugc");
  await tree.unmount();
});

test("a mailto link stays a link, without the new-tab hardening", async () => {
  const tree = await render(<AnnouncementMarkdown body={"[mail](mailto:hi@kumoritv.top)"} />);
  const link = tree.container.querySelector("a");
  assert.equal(link?.getAttribute("href"), "mailto:hi@kumoritv.top");
  assert.equal(link?.getAttribute("target"), null);
  await tree.unmount();
});

test("lists, quotes, rules and inline code render", async () => {
  const tree = await render(
    <AnnouncementMarkdown body={"- one\n- two\n\n> a quote\n\n---\n\n`code`"} />,
  );
  assert.equal(tree.container.querySelectorAll("li").length, 2);
  assert.ok(tree.container.querySelector("blockquote"));
  assert.ok(tree.container.querySelector("hr"));
  assert.ok(tree.container.querySelector("code"));
  await tree.unmount();
});

test("a very long unbroken URL renders without breaking the document", async () => {
  const long = `https://kumoritv.top/${"a".repeat(400)}`;
  const tree = await render(<AnnouncementMarkdown body={long} />);
  const link = tree.container.querySelector("a");
  assert.ok(link, "the autolink still exists");
  assert.equal(link?.getAttribute("href"), long);
  await tree.unmount();
});

test("an empty body renders nothing rather than 'undefined'", async () => {
  const tree = await render(<AnnouncementMarkdown body="" />);
  assert.equal((tree.container.textContent ?? "").trim(), "");
  await tree.unmount();
});

test("safeHref allows only https, http and mailto", () => {
  assert.equal(safeHref("https://a.test"), "https://a.test");
  assert.equal(safeHref("http://a.test"), "http://a.test");
  assert.equal(safeHref("mailto:a@b.test"), "mailto:a@b.test");
  assert.equal(safeHref("javascript:alert(1)"), null);
  assert.equal(safeHref("data:text/html,<b>"), null);
  assert.equal(safeHref("/community"), null);
  assert.equal(safeHref(undefined), null);
});
