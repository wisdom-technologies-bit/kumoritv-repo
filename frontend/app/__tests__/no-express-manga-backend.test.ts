import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(process.cwd(), "app");
const SOURCE = /\.(ts|tsx|js|jsx)$/;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules") return [];
      return sourceFiles(full);
    }
    return SOURCE.test(entry) ? [full] : [];
  });
}

test("no app source file references the dead Express manga backend", () => {
  const offenders = sourceFiles(root).filter((file) => {
    // Tests and the guard itself may name the variable.
    if (file.includes("__tests__")) return false;
    const source = readFileSync(file, "utf8");
    return /NEXT_PUBLIC_BACKEND_URL/.test(source);
  });

  assert.deepEqual(
    offenders.map((file) => relative(process.cwd(), file)),
    [],
    "manga must come from /api/manga (MangaDex directly), never from the old Express backend",
  );
});

test("the MangaDex client never reads a secret key", () => {
  const source = readFileSync(join(process.cwd(), "app/lib/manga/mangadex.ts"), "utf8");

  assert.ok(!/MANGADEX/.test(source), "no MangaDex credentials are used");
  assert.match(source, /KumoriTV\/1\.0/);
});
