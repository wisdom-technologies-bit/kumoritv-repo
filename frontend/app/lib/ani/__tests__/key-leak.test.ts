// The API key must live in the server process and nowhere else: not in a client
// chunk, not in a response body, not in a signed proxy token, not in an error.

import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyToken } from "@/app/lib/proxy/signing";
import {
  TEST_ANI_KEY,
  startWatchHarness,
  type WatchHarness,
} from "./watch-harness";

const here = dirname(fileURLToPath(import.meta.url));
// frontend/ : the Next app root, so `.next` and `app/` are both below it.
const APP_ROOT = join(here, "..", "..", "..", "..");

/** The value the build is produced with, so a leak has something to find. */
const BUILD_SENTINEL = "KUMORI_ANI_KEY_SENTINEL_do_not_ship";
const HEADER_NAME = "x-api-key";

function walk(directory: string, found: string[] = []): string[] {
  if (!existsSync(directory)) return found;
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) walk(full, found);
    else if (/\.(js|mjs|cjs|json|map|html|txt|css)$/.test(entry)) found.push(full);
  }
  return found;
}

function filesContaining(directory: string, needles: string[]) {
  const hits: string[] = [];
  for (const file of walk(directory)) {
    const text = readFileSync(file, "utf8");
    for (const needle of needles)
      if (text.includes(needle))
        hits.push(`${relative(APP_ROOT, file)} contains ${JSON.stringify(needle)}`);
  }
  return hits;
}

const BUILD_STATIC = join(APP_ROOT, ".next", "static");
const hasBuild = existsSync(BUILD_STATIC);

test(
  "no client chunk carries the key or the ani-api key header",
  { skip: hasBuild ? false : "no .next/static - run `npm run build` first" },
  () => {
    const hits = filesContaining(BUILD_STATIC, [BUILD_SENTINEL, TEST_ANI_KEY, HEADER_NAME]);
    assert.deepEqual(hits, []);
  },
);

test(
  "no server chunk from the build carries the key value either",
  { skip: hasBuild ? false : "no .next - run `npm run build` first" },
  () => {
    const hits = filesContaining(join(APP_ROOT, ".next"), [BUILD_SENTINEL]);
    assert.deepEqual(hits, []);
  },
);

test("every ani module is server-only, and none of them is public", () => {
  const directory = join(APP_ROOT, "app", "lib", "ani");
  const modules = readdirSync(directory).filter(
    (entry) => entry.endsWith(".ts") && statSync(join(directory, entry)).isFile(),
  );
  assert.ok(modules.length >= 8, "the module is really there");
  for (const entry of modules) {
    const source = readFileSync(join(directory, entry), "utf8");
    if (entry === "constants.ts") {
      // Client-safe names only: no server-only, and no environment access.
      assert.equal(source.includes('import "server-only"'), false);
      assert.equal(/process\.env/.test(source), false);
      continue;
    }
    assert.match(
      source.slice(0, 200),
      /import "server-only"/,
      `${entry} must be server-only`,
    );
  }
});

test("no NEXT_PUBLIC_ variant of any ani setting exists anywhere", () => {
  const hits = filesContaining(join(APP_ROOT, "app"), ["NEXT_PUBLIC_ANI"]);
  assert.deepEqual(hits, []);
});

test("only the server client reads ANI_API_KEY", () => {
  const directory = join(APP_ROOT, "app", "lib", "ani");
  const readers = readdirSync(directory)
    .filter((entry) => entry.endsWith(".ts"))
    .filter((entry) =>
      readFileSync(join(directory, entry), "utf8").includes("process.env.ANI_API_KEY"),
    );
  assert.deepEqual(readers, ["config.ts"]);
});

test("the route's success, tokens and error bodies never contain the key", async () => {
  let harness: WatchHarness | undefined;
  try {
    harness = await startWatchHarness();
    await harness.reset();
    process.env.ANI_PROVIDER_ENABLED = "1";

    const ok = await harness.call({ audio: "sub", sublang: "leak-ok" });
    assert.equal(ok.body.provider, "ani");
    const serialised = JSON.stringify(ok.body);
    assert.equal(serialised.includes(TEST_ANI_KEY), false);
    assert.equal(serialised.includes(harness.standin.url), false, "no API base url");
    assert.equal(serialised.toLowerCase().includes(HEADER_NAME), false);

    const manifest = await verifyToken(
      decodeURIComponent(new URLSearchParams(ok.body.url.split("?")[1]).get("t") || ""),
    );
    assert.equal(JSON.stringify(manifest).includes(TEST_ANI_KEY), false);
    assert.equal(JSON.stringify(manifest).toLowerCase().includes(HEADER_NAME), false);
    for (const track of ok.body.subtitles) {
      const payload = await verifyToken(
        decodeURIComponent(new URLSearchParams(track.url.split("?")[1]).get("t") || ""),
      );
      assert.equal(JSON.stringify(payload).includes(TEST_ANI_KEY), false);
    }

    await harness.reset();
    process.env.ANI_PROVIDER_ENABLED = "1";
    harness.standin.state.aniMode = "auth";
    const failed = await harness.call({ audio: "sub", sublang: "leak-fail", provider: "ani" });
    assert.equal(failed.status, 502);
    assert.equal(JSON.stringify(failed.body).includes(TEST_ANI_KEY), false);
    assert.equal(JSON.stringify(failed.body).includes(harness.standin.url), false);
  } finally {
    await harness?.close();
  }
});

