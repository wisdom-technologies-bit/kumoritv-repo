import assert from "node:assert/strict";
import test from "node:test";
import { absoluteUrl, isGenericEpisodeTitle, siteUrl, stripHtml, truncate } from "../text";

test("stripHtml removes tags and keeps the words apart", () => {
  assert.equal(stripHtml("<p>Hello <b>world</b>!</p>"), "Hello world!");
  assert.equal(stripHtml("Line one<br>line two"), "Line one line two");
  assert.equal(stripHtml("<i>Hi</i><br/>there"), "Hi there");
  assert.equal(stripHtml("<p>a</p>\n<p>b</p>"), "a b");
  assert.equal(stripHtml("  spaced   out  "), "spaced out");
  assert.equal(stripHtml("<script>alert(1)</script>ok"), "ok");
  assert.equal(stripHtml(""), "");
  assert.equal(stripHtml(null), "");
  assert.equal(stripHtml(undefined), "");
  assert.equal(stripHtml(42), "");
});

test("stripHtml decodes entities once", () => {
  assert.equal(stripHtml("Tom &amp; Jerry"), "Tom & Jerry");
  assert.equal(stripHtml("&lt;b&gt;not bold&lt;/b&gt;"), "<b>not bold</b>");
  assert.equal(stripHtml("It&apos;s &quot;fine&quot;"), "It's \"fine\"");
  assert.equal(stripHtml("caf&eacute; &#39;quoted&#39;"), "café 'quoted'");
  assert.equal(stripHtml("&amp;amp;"), "&amp;");
  assert.equal(stripHtml("100&nbsp;%"), "100 %");
});

test("truncate cuts on a word boundary and stays inside the limit", () => {
  assert.equal(truncate("short", 10), "short");
  assert.equal(truncate("one two three four", 9), "one two…");
  const long = truncate("a".repeat(200), 160);
  assert.ok(long.length <= 160);
  assert.ok(long.endsWith("…"));
  assert.equal(truncate("", 10), "");
  assert.equal(truncate("anything", 0), "");
  assert.equal(truncate("Supercalifragilistic", 8), "Superca…");
  const sentence = truncate("The quick brown fox jumps over the lazy dog", 20);
  assert.ok(sentence.length <= 20, sentence);
  assert.ok(!sentence.includes("  "));
});

test("isGenericEpisodeTitle spots placeholders", () => {
  assert.equal(isGenericEpisodeTitle("Episode 5"), true);
  assert.equal(isGenericEpisodeTitle("episode 12"), true);
  assert.equal(isGenericEpisodeTitle("EP. 3"), true);
  assert.equal(isGenericEpisodeTitle("Ep 7"), true);
  assert.equal(isGenericEpisodeTitle("   "), true);
  assert.equal(isGenericEpisodeTitle(null), true);
  assert.equal(isGenericEpisodeTitle(undefined), true);
  assert.equal(isGenericEpisodeTitle("Episode 5 - Romance Dawn"), false);
  assert.equal(isGenericEpisodeTitle("Romance Dawn"), false);
  assert.equal(isGenericEpisodeTitle("I Am an Episode of Madness"), false);
});

test("absoluteUrl builds URLs on the configured origin", () => {
  const previous = process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.NEXT_PUBLIC_SITE_URL;
  assert.equal(siteUrl(), "https://kumoritv.vercel.app");
  assert.equal(absoluteUrl("/watch/21"), "https://kumoritv.vercel.app/watch/21");
  assert.equal(absoluteUrl("og/21"), "https://kumoritv.vercel.app/og/21");
  assert.equal(absoluteUrl("https://cdn.example/a.png"), "https://cdn.example/a.png");
  process.env.NEXT_PUBLIC_SITE_URL = "https://staging.example/";
  assert.equal(siteUrl(), "https://staging.example");
  assert.equal(absoluteUrl("/og/1/2"), "https://staging.example/og/1/2");
  if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = previous;
});
