// Prompt 38F: the clip-URL truth table.
//
// Every case here is a decision the composer and validateCreatePost both rely
// on. The refused list matters more than the accepted one: a lookalike host or
// a userinfo URL that slipped through would turn a stranger's link into an
// attachment the author never chose.
import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedClipHosts,
  clipUrlMessage,
  containsClipUrl,
  extractClipUrl,
  isAllowedClipHost,
  parseClipInput,
  parseClipUrl,
} from "../clip-url";

const CODE = "abc2345";

/** Development is the mode the unit tests run in, so localhost is allowed here. */
const ACCEPTED = [
  `https://kumoritv.top/clip/${CODE}`,
  `http://kumoritv.top/clip/${CODE}`,
  `https://www.kumoritv.top/clip/${CODE}`,
  `kumoritv.top/clip/${CODE}`,
  `//kumoritv.top/clip/${CODE}`,
  `HTTPS://KUMORITV.TOP/clip/${CODE}`,
  `https://kumoritv.top/clip/${CODE}/`,
  `https://kumoritv.top/clip/${CODE}?t=62`,
  `https://kumoritv.top/clip/${CODE}#x`,
  ` http://kumoritv.top/clip/${CODE} `,
  `http://localhost:3000/clip/${CODE}`,
  `http://127.0.0.1:3000/clip/${CODE}`,
  `https://kumoritv.top/clip/bcd3456`,
  `https://kumoritv.top/clip/zzz9999`,
];

const REFUSED: [string, string][] = [
  [`https://evil.com/clip/${CODE}`, "host"],
  [`https://kumoritv.top.evil.com/clip/${CODE}`, "host"],
  [`https://kumoritv.top@evil.com/clip/${CODE}`, "host"],
  [`https://evil.com@kumoritv.top/clip/${CODE}`, "host"],
  [`https://kumoritv.top/clip/abc234`, "code"],
  [`https://kumoritv.top/clip/abc23456`, "code"],
  [`https://kumoritv.top/clip/ABC2345`, "code"],
  [`https://kumoritv.top/clip/abc2340`, "code"],
  [`https://kumoritv.top/clip/abcdefl`, "code"],
  [`https://kumoritv.top/clip/${CODE}/extra`, "path"],
  [`https://kumoritv.top/watch/101?ep=5`, "path"],
  [`https://kumoritv.top/clip/`, "path"],
  ["javascript:alert(1)", "scheme"],
  ["JavaScript:alert(1)", "scheme"],
  ["data:text/html,<script>alert(1)</script>", "scheme"],
  ["vbscript:msgbox(1)", "scheme"],
  ["file:///etc/passwd", "scheme"],
  ["", "empty"],
  ["not a url at all", "host"],
];

test(`accepted: ${ACCEPTED.length} spellings of one clip link`, () => {
  for (const value of ACCEPTED) {
    const result = parseClipUrl(value);
    assert.equal(result.kind, "clip", `should accept ${JSON.stringify(value)}`);
    if (result.kind === "clip") assert.match(result.code, /^[23456789abcdefghjkmnpqrstuvwxyz]{7}$/);
  }
});

test(`refused: ${REFUSED.length} links that must never become an attachment`, () => {
  for (const [value, reason] of REFUSED) {
    const result = parseClipUrl(value);
    assert.equal(result.kind, "invalid", `should refuse ${JSON.stringify(value)}`);
    if (result.kind === "invalid") assert.equal(result.reason, reason, `reason for ${JSON.stringify(value)}`);
  }
});

test("a bare code is a clip in the paste box and not in free text", () => {
  const pasted = parseClipInput(CODE);
  assert.equal(pasted.kind, "clip");

  // Free text: "abc2345" is a word, not an attachment.
  assert.equal(extractClipUrl(`I loved ${CODE}`), null);
  assert.equal(containsClipUrl(`I loved ${CODE}`), false);

  // And the paste box refuses a bare code that is not a code.
  assert.equal(parseClipInput("abc234").kind, "invalid");
  assert.equal(parseClipInput("hello world").kind, "invalid");
});

test("free text: the link is removed and the words are kept", () => {
  const found = extractClipUrl(`this fight https://kumoritv.top/clip/${CODE} is unreal`);
  assert.ok(found);
  assert.equal(found?.code, CODE);
  assert.equal(found?.text, "this fight is unreal");

  // Nothing left behind but whitespace: the whole body is the link.
  const alone = extractClipUrl(`https://kumoritv.top/clip/${CODE}`);
  assert.equal(alone?.text, "");

  // Two links: only the first is attached, and only it is removed.
  const two = extractClipUrl(
    `https://kumoritv.top/clip/${CODE} and https://kumoritv.top/clip/bcd3456`,
  );
  assert.equal(two?.code, CODE);
  assert.equal(two?.text, "and https://kumoritv.top/clip/bcd3456");
});

test("free text: a non-clip link stays exactly where it was", () => {
  for (const text of [
    "read https://evil.com/clip/abc2345 instead",
    "source https://kumoritv.top/watch/101?ep=5",
    "https://kumoritv.top.evil.com/clip/abc2345",
    "javascript:alert(1)",
  ]) {
    assert.equal(extractClipUrl(text), null, text);
    assert.equal(containsClipUrl(text), false, text);
  }
});

test("the host allowlist is the site's own origins, never the whole internet", () => {
  const hosts = allowedClipHosts();
  assert.ok(hosts.has("kumoritv.top"));
  assert.ok(hosts.has("www.kumoritv.top"));
  assert.ok(!hosts.has("evil.com"));
  assert.equal(isAllowedClipHost("kumoritv.top"), true);
  assert.equal(isAllowedClipHost("KUMORITV.TOP"), true);
  assert.equal(isAllowedClipHost("kumoritv.top.evil.com"), false);
  assert.equal(isAllowedClipHost("evil.com"), false);
});

test("every refusal has a sentence a person can act on", () => {
  const reasons = ["empty", "scheme", "host", "path", "code"] as const;
  for (const reason of reasons) {
    const message = clipUrlMessage({ kind: "invalid", reason });
    assert.equal(typeof message, "string");
    assert.ok((message ?? "").length > 10, reason);
  }
  assert.equal(clipUrlMessage({ kind: "clip", code: CODE, host: "kumoritv.top" }), null);
});
