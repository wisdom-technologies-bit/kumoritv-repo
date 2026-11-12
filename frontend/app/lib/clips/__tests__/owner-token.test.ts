// Prompt 35: guest ownership tokens and their hashes.

import assert from "node:assert/strict";
import test from "node:test";
import {
  createOwnerToken,
  hashIdentifier,
  hashOwnerToken,
  ownerTokenMatches,
  OWNER_TOKEN_BYTES,
} from "../owner-token";

test("tokens are random, url-safe and long enough to be unguessable", () => {
  const seen = new Set<string>();
  for (let run = 0; run < 200; run += 1) {
    const token = createOwnerToken();
    assert.match(token, /^[A-Za-z0-9_-]+$/, "base64url only");
    // 32 bytes -> 43 characters, no padding.
    assert.equal(token.length, Math.ceil((OWNER_TOKEN_BYTES * 4) / 3));
    assert.equal(seen.has(token), false, "tokens must not repeat");
    seen.add(token);
  }
});

test("the hash is deterministic and never contains the token", () => {
  const token = "a".repeat(43);
  const hash = hashOwnerToken(token);
  assert.ok(hash);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hashOwnerToken(token), hash);
  assert.equal(hash.includes(token), false);
  assert.notEqual(hashOwnerToken("b".repeat(43)), hash);
});

test("a server secret turns the hash into an HMAC", () => {
  const token = createOwnerToken();
  const plain = hashOwnerToken(token);
  const withSecret = hashOwnerToken(token, "server-secret");
  const withOtherSecret = hashOwnerToken(token, "another-secret");

  assert.ok(withSecret && plain);
  assert.notEqual(withSecret, plain);
  assert.notEqual(withSecret, withOtherSecret);
  // Same secret, same token: still deterministic.
  assert.equal(hashOwnerToken(token, "server-secret"), withSecret);
  // A blank secret is treated as "no secret".
  assert.equal(hashOwnerToken(token, "   "), plain);
});

test("junk tokens are refused instead of hashed", () => {
  for (const value of [null, undefined, "", "   ", "short", 42, {}, []]) {
    assert.equal(hashOwnerToken(value), null, `hashed ${JSON.stringify(value)}`);
  }
  assert.equal(hashOwnerToken("x".repeat(200)), null, "absurdly long tokens are refused");
});

test("matches are true only for the same token and hash", () => {
  const token = createOwnerToken();
  const hash = hashOwnerToken(token, "s3cret");

  assert.equal(ownerTokenMatches(token, hash, "s3cret"), true);
  assert.equal(ownerTokenMatches(`${token}x`, hash, "s3cret"), false);
  assert.equal(ownerTokenMatches(token, hash, "wrong"), false);
  assert.equal(ownerTokenMatches(token, null, "s3cret"), false);
  assert.equal(ownerTokenMatches(token, "not-hex", "s3cret"), false);
  assert.equal(ownerTokenMatches(undefined, hash, "s3cret"), false);
  // A hash made without the secret must not match one made with it.
  assert.equal(ownerTokenMatches(token, hashOwnerToken(token), "s3cret"), false);
});

test("reporter hashes are salted and hold no raw identifier", () => {
  const hash = hashIdentifier("report:203.0.113.7", "s3cret");
  assert.ok(hash);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash.includes("203.0.113.7"), false);
  assert.equal(hash, hashIdentifier("report:203.0.113.7", "s3cret"));
  assert.notEqual(hash, hashIdentifier("report:203.0.113.7"));
  assert.equal(hashIdentifier("   "), null);
  assert.equal(hashIdentifier(null), null);
});
