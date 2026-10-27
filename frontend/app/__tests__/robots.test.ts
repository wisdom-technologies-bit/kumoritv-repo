import assert from "node:assert/strict";
import test from "node:test";
import robots from "@/app/robots";

test("robots.txt allows the public site and blocks api and auth only", () => {
  const result = robots() as {
    rules: { userAgent: string; allow: string; disallow: string | string[] };
    sitemap: string;
  };
  const disallow = Array.isArray(result.rules.disallow) ? result.rules.disallow : [result.rules.disallow];
  assert.equal(result.rules.allow, "/");
  assert.ok(disallow.includes("/api/"));
  assert.ok(disallow.includes("/auth/"));
  assert.ok(result.sitemap.endsWith("/sitemap.xml"));
});

test("the /og/ image route is not disallowed", () => {
  const result = robots() as { rules: { disallow: string | string[] } };
  const disallow = Array.isArray(result.rules.disallow) ? result.rules.disallow : [result.rules.disallow];
  assert.equal(disallow.some((entry) => entry === "/og" || entry.startsWith("/og/") || entry === "/og/*"), false);
});
