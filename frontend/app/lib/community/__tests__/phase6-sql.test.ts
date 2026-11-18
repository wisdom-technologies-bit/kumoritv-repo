// Phase 6: the moderation SQL, executed for real.
//
// The work lives in test-harness/phase6-sql-check.mjs: PGlite (Postgres in WASM)
// runs the whole community chain in its documented order, then
// community-phase-6.sql twice, then moderates rows as a moderator, an author and
// a plain viewer. It runs in a child process because PGlite loads its WASM bundle
// from a file URL, which the harness's CommonJS transform cannot provide.
//
// Run it by hand with: node test-harness/phase6-sql-check.mjs

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(__dirname, "../../../..");

test("community-phase-6.sql moderates, logs once per change, hides content per viewer and rolls back", () => {
  try {
    const output = execFileSync("node", [path.join(ROOT, "test-harness/phase6-sql-check.mjs")], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 180_000,
    });
    assert.match(output, /all checks passed/);
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message?: string };
    assert.fail(`${failure.stdout ?? ""}\n${failure.stderr ?? failure.message ?? "phase6 sql check failed"}`);
  }
});
