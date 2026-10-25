import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeNextPath } from "./auth";

test("sanitizes same-site relative paths", () => {
  assert.equal(sanitizeNextPath("/watch/1?ep=2"), "/watch/1?ep=2");
  assert.equal(sanitizeNextPath("//evil.com"), "/");
  assert.equal(sanitizeNextPath("https://evil.com"), "/");
  assert.equal(sanitizeNextPath("/\\evil.com"), "/");
  assert.equal(sanitizeNextPath("javascript:"), "/");
  assert.equal(sanitizeNextPath(""), "/");
});
