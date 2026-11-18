// Part A: the new-post bar, reproduced deterministically.
//
// Every test drives /api/community/latest with page.route, so the sequence is
// exact: existing items, an empty community, 304s, a hidden tab, a route change,
// guest vs signed in, a missing profile column, the viewer's own post. The real
// pages and the real root layout are used; the poll interval is shortened to 2 s
// in playwright.config.ts.
//
// Why this file exists: the Phase 4 bar was green in CI and dead in production.
// The stand-in returned items for a request with no cursor; the real SQL returns
// NOTHING until it is given one. These scripts model the real shape, including
// the server seed cursor.
import { expect, test, type Page, type Route } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const SHOTS = path.resolve(__dirname, "screenshots");
mkdirSync(SHOTS, { recursive: true });

const VIEWER_ID = "10000000-0000-4000-8000-000000000101";
const OTHER_ID = "10000000-0000-4000-8000-000000000202";
const BASE = Date.UTC(2026, 10, 17, 12, 0, 0);
const iso = (offsetMs: number) => new Date(BASE + offsetMs).toISOString();

type LatestBody = { items: Array<Record<string, unknown>>; cursor: string | null };
type Scripted = { status?: number; body?: LatestBody; delayMs?: number };
type Recorder = { pollCount: number; seenAfter: Array<string | null> };

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: "post-1",
    kind: "post",
    authorId: OTHER_ID,
    authorName: "Ada",
    authorAvatar: null,
    text: "A brand new post",
    hasClip: false,
    clipThumb: null,
    adult: false,
    href: "/community/post/post-1",
    createdAt: iso(0),
    ...overrides,
  };
}

/** Five items that already existed: the first poll's seed. */
function backlog(cursorOffset = 0) {
  return Array.from({ length: 5 }, (_, index) =>
    item({
      id: `old-${index}`,
      href: `/community/post/old-${index}`,
      text: `Old post ${index}`,
      createdAt: iso(cursorOffset - index * 60_000),
    }),
  );
}

/** Serves a scripted sequence; repeats the last step forever after the end. */
async function scriptLatest(page: Page, script: Scripted[]): Promise<Recorder> {
  const recorder: Recorder = { pollCount: 0, seenAfter: [] };
  let index = 0;
  await page.route("**/api/community/latest**", async (route: Route) => {
    recorder.pollCount += 1;
    recorder.seenAfter.push(new URL(route.request().url()).searchParams.get("after"));
    const step = script[Math.min(index, script.length - 1)];
    index += 1;
    if (step.delayMs) await new Promise((resolve) => setTimeout(resolve, step.delayMs));
    if ((step.status ?? 200) === 304) {
      await route.fulfill({ status: 304, headers: { etag: 'W/"scripted-304"' }, body: "" }).catch(() => {});
      return;
    }
    await route
      .fulfill({
        status: step.status ?? 200,
        contentType: "application/json",
        headers: { etag: `W/"scripted-${index}"` },
        body: JSON.stringify(step.body ?? { items: [], cursor: null }),
      })
      .catch(() => {});
  });
  return recorder;
}

async function waitForPolls(recorder: Recorder, count: number) {
  await expect
    .poll(() => recorder.pollCount, { timeout: 25_000, message: `waiting for poll ${count}` })
    .toBeGreaterThanOrEqual(count);
}

async function signIn(page: Page) {
  const session = {
    access_token: "standin.access.token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: "r",
    user: {
      id: VIEWER_ID,
      aud: "authenticated",
      role: "authenticated",
      email: "adaeze@example.test",
      is_anonymous: false,
      user_metadata: { display_name: "Adaeze", username: "adaeze" },
    },
  };
  await page.context().addCookies([
    { name: "standin-user", value: "1", path: "/", domain: "127.0.0.1" },
    { name: "sb-127-auth-token", value: JSON.stringify(session), path: "/", domain: "127.0.0.1" },
  ]);
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  writeFileSync(
    path.join(SHOTS, `${name}.json`),
    JSON.stringify({ name, url: page.url(), viewport: page.viewportSize() }, null, 2),
  );
}

test.describe.configure({ mode: "serial" });

test("(a) five existing items, then one new post from another author: a toast appears", async ({ page }) => {
  const recorder = await scriptLatest(page, [
    { body: { items: backlog(0), cursor: iso(0) } },
    { body: { items: [item({ id: "fresh", createdAt: iso(30_000), text: "Something new" })], cursor: iso(30_000) } },
  ]);
  await page.goto("/terms");
  await waitForPolls(recorder, 2);
  await expect(page.locator('[data-testid="community-toast"]')).toBeVisible({ timeout: 12_000 });
  await shot(page, "repro-a-new-post");
  expect(recorder.seenAfter[1]).toBeTruthy();
  expect(Date.parse(String(recorder.seenAfter[1]))).toBeLessThanOrEqual(BASE);
});

test("(b) an EMPTY first poll, then the first real post: a toast appears", async ({ page }) => {
  const recorder = await scriptLatest(page, [
    { body: { items: [], cursor: new Date(BASE - 10_000).toISOString() } },
    { body: { items: [item({ id: "first-ever", createdAt: iso(30_000), text: "First post" })], cursor: iso(30_000) } },
  ]);
  await page.goto("/terms");
  await waitForPolls(recorder, 2);
  await expect(page.locator('[data-testid="community-toast"]')).toBeVisible({ timeout: 12_000 });
  await shot(page, "repro-b-empty-then-first");
});

test("(c) a post that arrived while the tab was hidden shows when the tab returns", async ({ page }) => {
  const recorder = await scriptLatest(page, [
    { body: { items: backlog(0), cursor: iso(0) } },
    { body: { items: [item({ id: "while-away", createdAt: iso(40_000), text: "While you were away" })], cursor: iso(40_000) } },
  ]);
  await page.goto("/terms");
  await waitForPolls(recorder, 1);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator('[data-testid="community-toast"]')).toBeVisible({ timeout: 15_000 });
  await shot(page, "repro-c-hidden-tab");
});

test("(d) a 304 sequence is the steady state, and the next new item still appears", async ({ page }) => {
  const recorder = await scriptLatest(page, [
    { body: { items: backlog(0), cursor: iso(0) } },
    { status: 304 },
    { status: 304 },
    { body: { items: [item({ id: "after-304", createdAt: iso(90_000), text: "After two 304s" })], cursor: iso(90_000) } },
  ]);
  await page.goto("/terms");
  await waitForPolls(recorder, 4);
  await expect(page.locator('[data-testid="community-toast"]')).toBeVisible({ timeout: 12_000 });
  await shot(page, "repro-d-304");
});

test("(e) a client-side route change between polls does not stop the bar", async ({ page }) => {
  const recorder = await scriptLatest(page, [
    { body: { items: backlog(0), cursor: iso(0) } },
    { body: { items: [item({ id: "after-nav", createdAt: iso(60_000), text: "After a route change" })], cursor: iso(60_000) } },
  ]);
  await page.goto("/terms");
  await waitForPolls(recorder, 1);
  await page.locator('footer a[href="/privacy"]').first().click();
  await page.waitForURL("**/privacy");
  await expect(page.locator('[data-testid="community-toast"]')).toBeVisible({ timeout: 15_000 });
  await shot(page, "repro-e-route-change");
});

test("(f) guest AND signed-in viewers both get the toast", async ({ page }) => {
  const guest = await scriptLatest(page, [
    { body: { items: backlog(0), cursor: iso(0) } },
    { body: { items: [item({ id: "g", createdAt: iso(30_000), text: "For guests" })], cursor: iso(30_000) } },
  ]);
  await page.goto("/terms");
  await waitForPolls(guest, 2);
  await expect(page.locator('[data-testid="community-toast"]')).toBeVisible({ timeout: 12_000 });
  await page.unroute("**/api/community/latest**");

  await signIn(page);
  const user = await scriptLatest(page, [
    { body: { items: backlog(0), cursor: iso(0) } },
    { body: { items: [item({ id: "u", createdAt: iso(30_000), text: "For signed-in readers" })], cursor: iso(30_000) } },
  ]);
  await page.goto("/terms");
  await waitForPolls(user, 2);
  await expect(page.locator('[data-testid="community-toast"]')).toBeVisible({ timeout: 12_000 });
  await shot(page, "repro-f-signed-in");
});

test("(g) a signed-in profile row with no community_toasts column: the toast is ON", async ({ page }) => {
  await signIn(page);
  const recorder = await scriptLatest(page, [
    { body: { items: backlog(0), cursor: iso(0) } },
    { body: { items: [item({ id: "missing-col", createdAt: iso(30_000) })], cursor: iso(30_000) } },
  ]);
  await page.goto("/terms?toastdebug=1");
  await waitForPolls(recorder, 2);
  await expect(page.locator('[data-testid="toast-debug"]')).toContainText("setting on");
  await expect(page.locator('[data-testid="community-toast"]')).toBeVisible({ timeout: 12_000 });
  await shot(page, "repro-g-missing-setting-column");
});

test("(h) the same account never sees its own post, and says why", async ({ page }) => {
  await signIn(page);
  const recorder = await scriptLatest(page, [
    { body: { items: backlog(0), cursor: iso(0) } },
    { body: { items: [item({ id: "mine", authorId: VIEWER_ID, createdAt: iso(30_000) })], cursor: iso(30_000) } },
    { body: { items: [item({ id: "mine", authorId: VIEWER_ID, createdAt: iso(30_000) })], cursor: iso(30_000) } },
  ]);
  await page.goto("/terms?toastdebug=1");
  await waitForPolls(recorder, 3);
  await page.waitForTimeout(500);
  await expect(page.locator('[data-testid="community-toast"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="toast-debug-reason"]')).toContainText("own item");
  await shot(page, "repro-h-own-post");
});

test("?toastdebug=1 shows the chip and its sample toast; the chip is absent without it", async ({ page }) => {
  await page.goto("/terms");
  await expect(page.locator('[data-testid="toast-debug"]')).toHaveCount(0);

  await page.goto("/terms?toastdebug=1");
  const chip = page.locator('[data-testid="toast-debug"]');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText("enabled on");
  await expect(chip).toContainText("path ok");
  await shot(page, "toast-debug-chip");

  await page.getByTestId("toast-debug-sample").click();
  await expect(page.locator('[data-testid="community-toast"]')).toBeVisible();
  await shot(page, "toast-debug-sample");
});

test("on /community the toast is suppressed by design and the chip says path", async ({ page }) => {
  const recorder = await scriptLatest(page, [
    { body: { items: backlog(0), cursor: iso(0) } },
    { body: { items: [item({ id: "feed", createdAt: iso(30_000) })], cursor: iso(30_000) } },
  ]);
  await page.goto("/community?toastdebug=1");
  await waitForPolls(recorder, 2);
  await expect(page.locator('[data-testid="toast-debug-reason"]')).toContainText("path");
  await expect(page.locator('[data-testid="community-toast"]')).toHaveCount(0);
  await shot(page, "repro-community-pill-instead");
});
