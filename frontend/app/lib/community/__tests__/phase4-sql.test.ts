// Phase 4, part C: the SQL check, inside `npm test`.
//
// The real work lives in test-harness/phase4-sql-check.mjs (Postgres via PGlite,
// run as one paste twice, then `community_latest` against fixtures). It runs in
// a child process because PGlite loads its WASM bundle from a file URL and the
// harness's CommonJS transform cannot provide one.
//
// Run it by hand with: node test-harness/phase4-sql-check.mjs

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(__dirname, "../../../..");

test("docs/sql/community-phase-4.sql is idempotent and community_latest is correct", () => {
  try {
    const output = execFileSync("node", [path.join(ROOT, "test-harness/phase4-sql-check.mjs")], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
    });
    assert.match(output, /all checks passed/);
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message?: string };
    assert.fail(`${failure.stdout ?? ""}\n${failure.stderr ?? failure.message ?? "phase4 sql check failed"}`);
  }
});
