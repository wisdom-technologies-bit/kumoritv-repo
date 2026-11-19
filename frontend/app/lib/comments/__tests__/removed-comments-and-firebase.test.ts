import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const appDir = join(process.cwd(), "app");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (entry === "__tests__") return [];
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.(ts|tsx|js|jsx|css)$/.test(path) ? [path] : [];
  });
}

const appFiles = walk(appDir);

function relative(path: string) {
  return path.slice(process.cwd().length + 1);
}

test("the deprecated comments component is gone and nothing imports it", () => {
  assert.equal(
    existsSync(join(appDir, "components", "[DEPRECATED]CommentsSection")),
    false,
    "the deprecated component folder should be deleted",
  );

  const importers = appFiles.filter((path) => readFileSync(path, "utf8").includes("DEPRECATED]CommentsSection"));

  assert.deepEqual(importers.map(relative), []);
});

test("comments only talk to Supabase through the new section", () => {
  const commentFiles = walk(join(appDir, "components", "CommentsSection")).concat(
    walk(join(appDir, "lib", "comments")),
  );

  const firestoreUsers = commentFiles.filter((path) => /firebase/i.test(readFileSync(path, "utf8")));
  assert.deepEqual(firestoreUsers.map(relative), []);

  const reduxAnilistChecks = commentFiles.filter((path) =>
    /state\.UserInfo|anilistUser/.test(readFileSync(path, "utf8")),
  );
  assert.deepEqual(reduxAnilistChecks.map(relative), []);
});

test("firebase is gone: nothing reaches it and the dependency is dropped", () => {
  // Part A moved the AniList login onto the Supabase bridge, which was the last
  // live path to Firestore, so the package and its wrappers were removed.
  const expectedImporters: string[] = [];

  const importers = appFiles
    .filter((path) =>
      /from\s+["'](firebase[^"']*|react-firebase-hooks[^"']*|@\/app\/firebaseApp|\.\.?\/.*userLoginActions)/.test(
        readFileSync(path, "utf8"),
      ),
    )
    .map(relative)
    .sort();

  assert.deepEqual(importers, expectedImporters);

  const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
  assert.equal(packageJson.dependencies.firebase, undefined, "firebase is no longer a dependency");
  assert.equal(packageJson.dependencies["react-firebase-hooks"], undefined, "react-firebase-hooks is gone too");
});
