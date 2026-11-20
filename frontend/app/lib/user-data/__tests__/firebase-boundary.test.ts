import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const frontendRoot = resolve(process.cwd());
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const skipped = new Set(["node_modules", ".next", ".git", "test-harness"]);

// Part A removed the last live Firebase path (the AniList login), so the list of
// files allowed to import it is empty and nothing may bring it back.
const allowed: string[] = [];

function collect(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      if (skipped.has(entry.name) || entry.name.startsWith(".")) return [];
      return collect(join(directory, entry.name));
    }
    return sourceExtensions.has(extname(entry.name)) ? [join(directory, entry.name)] : [];
  });
}

const forbidden = /from\s+["'](firebase[^"']*|react-firebase-hooks[^"']*|@\/app\/firebaseApp)["']|require\(["'](firebase[^"']*|@\/app\/firebaseApp)["']\)/;

test("nothing in app or lib imports Firebase", () => {
  const files = [
    ...collect(join(frontendRoot, "app")),
    ...collect(join(frontendRoot, "lib")),
  ].filter((file) => statSync(file).isFile());

  const offenders = files
    .map((file) => ({ file, relative: relative(frontendRoot, file).replace(/\\/g, "/") }))
    .filter(({ relative: path }) => {
      if (allowed.includes(path)) return false;
      return forbidden.test(readFileSync(join(frontendRoot, path), "utf8"));
    })
    .map(({ relative: path }) => path);

  assert.deepEqual(offenders, []);
});
