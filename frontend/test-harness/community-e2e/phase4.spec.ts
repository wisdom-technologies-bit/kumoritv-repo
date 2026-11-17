// Phase 4 (A + B) in a real browser, against the production build.
//
// Two Next servers share one build (see playwright.config.ts): 3100 with
// COMMUNITY_ENABLED=1 and a 2 s poll interval, 3101 with the flag off. Supabase
// is the local stand-in. Nothing here touches a real project, a real OneSignal
// app or a real phone.
//
// Every number in this file is measured, not eyeballed: the toast duration, the
// truncated line at 360/390/412, the absence of the bar on /community and in
// fullscreen, and the composer writing the sample announcement end to end.
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const SHOTS = path.resolve(__dirname, "screenshots");
mkdirSync(SHOTS, { recursive: true });

const PORT = Number(process.env.E2E_PORT || 3100);
const APP = `http://127.0.0.1:${PORT}`;
// The bar is tested on /terms, not on /: the home page fetches AniList at request
// time and this harness has no network, so / is the one page that cannot render
// here (pre-existing, nothing to do with Phase 4). /terms is a static page with
// the same root layout, so the bar mounts exactly as it does everywhere else.
const QUIET_PAGE = "/terms";
const OFF = `http://127.0.0.1:${PORT + 1}`;

const SAMPLE_TITLE = "Service Update: KumoriTV Is Back Online!";
const SAMPLE_BODY = `# Service Update: KumoriTV Is Back Online!

We are pleased to announce that **KumoriTV is fully accessible again!**

The temporary service disruption has been resolved, and our website is back up and running.

We sincerely apologise for the inconvenience ... Thank you for staying with us.

**We're back. Happy watching!**

*The KumoriTV Team*
https://kumoritv.top`;

function record(name: string, data: Record<string, unknown>) {
  writeFileSync(path.join(SHOTS, `${name}.json`), JSON.stringify({ name, at: new Date().toISOString(), ...data }, null, 2));
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
  record(name, { url: page.url(), viewport: page.viewportSize() });
}

/** "Someone just posted" - the stub appends one item to the latest feed. */
async function someonePosted(page: Page, options: { text: string; clip?: boolean; adult?: boolean }) {
  const query = new URLSearchParams({ new_post: options.text });
  if (options.clip) query.set("clip", "1");
  if (options.adult) query.set("adult", "1");
  const response = await page.request.get(`http://127.0.0.1:${Number(process.env.STUB_PORT || 54329)}/__fixture?${query.toString()}`);
  expect(response.ok()).toBeTruthy();
}

/** The first poll seeds the cursor silently, so give it time to happen. */
async function waitForFirstPoll(page: Page) {
  await page.waitForTimeout(2_800);
}

// The composer's gate is server-side: it reads the @supabase/ssr session cookie
// (`sb-127-auth-token`) and then asks the stand-in for `is_admin()`. The plain
// stand-in flag alone would only satisfy the browser-side client, so both go in:
// the session for the page check, the flag for anything the client asks.
function adminSession() {
  return {
    access_token: "standin.access.token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: "r",
    user: {
      id: "10000000-0000-4000-8000-000000000101",
      aud: "authenticated",
      role: "authenticated",
      email: "adaeze@example.test",
      is_anonymous: false,
      user_metadata: { display_name: "Adaeze", username: "adaeze" },
    },
  };
}

async function signInAsAdmin(page: Page) {
  await page.context().addCookies([
    { name: "standin-user", value: "1", path: "/", domain: "127.0.0.1" },
    { name: "sb-127-auth-token", value: JSON.stringify(adminSession()), path: "/", domain: "127.0.0.1" },
  ]);
}

test.describe.configure({ mode: "serial" });

test("desktop 1440: the bar appears once, stays ~5 s and never overflows", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(QUIET_PAGE);
  await waitForFirstPoll(page);

  await someonePosted(page, { text: "Just finished the new episode and I need to talk about it" });

  const toast = page.locator('[data-testid="community-toast"]');
  await toast.waitFor({ state: "visible", timeout: 15_000 });
  const shownAt = Date.now();
  await shot(page, "toast-desktop-1440");

  await toast.waitFor({ state: "detached", timeout: 15_000 });
  const visibleMs = Date.now() - shownAt;
  record("toast-desktop-1440.timing", { visibleMs });

  // 5 s + the 200 ms fade, measured end to end.
  expect(visibleMs, `toast visible for ${visibleMs} ms`).toBeGreaterThan(4_700);
  expect(visibleMs, `toast visible for ${visibleMs} ms`).toBeLessThan(6_400);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "no horizontal overflow with the bar shown").toBeLessThanOrEqual(0);
});

for (const width of [360, 390, 412] as const) {
  test(`mobile ${width}: one line, truncated, with the video icon outside the ellipsis`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(QUIET_PAGE);
    await waitForFirstPoll(page);

    // A long line with a clip, so the text cannot fit and the icon has to survive.
    await someonePosted(page, {
      text: "This fight is the whole reason the arc works and honestly the animation budget went straight into these ninety seconds alone",
      clip: true,
    });

    const toast = page.locator('[data-testid="community-toast"]');
    await toast.waitFor({ state: "visible", timeout: 15_000 });

    const text = page.locator('[data-testid="community-toast-text"]');
    const icon = page.locator('[data-testid="community-toast-clip-icon"]');

    const metrics = await text.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      lines: Math.round(element.getBoundingClientRect().height),
    }));
    expect(metrics.scrollWidth, "the line is truncated, not wrapped").toBeGreaterThan(metrics.clientWidth);

    const box = await icon.boundingBox();
    expect(box, "the icon is rendered").toBeTruthy();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);

    // Sibling, not a child: the icon's parent is not the truncating span.
    const parentIsText = await icon.evaluate(
      (element) => element.parentElement?.getAttribute("data-testid") === "community-toast-text",
    );
    expect(parentIsText, "the icon is a SIBLING of the truncating span").toBe(false);

    if (width === 360) await shot(page, "toast-mobile-360-truncated");
    record(`toast-mobile-${width}.metrics`, { width, ...metrics, icon: box });
  });
}

test("no bar on /community, and the pill counts instead", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/community");
  await page.waitForSelector("[data-feed-key]");
  await waitForFirstPoll(page);

  await someonePosted(page, { text: "A fresh post that should not interrupt the reader" });

  const pill = page.locator('[data-testid="community-new-post-pill"]');
  await pill.waitFor({ state: "visible", timeout: 15_000 });
  await expect(pill).toContainText(/1 new post/i);
  await expect(page.locator('[data-testid="community-toast"]')).toHaveCount(0);

  // Clicking it scrolls to the top and refreshes the feed without a reload.
  await page.evaluate(() => window.scrollTo(0, 400));
  await pill.click();
  await expect(page.locator('[data-testid="community-toast"]')).toHaveCount(0);
  const scrollY = await page.evaluate(() => window.scrollY);
  expect(scrollY, "clicking the pill scrolls to the top").toBeLessThan(200);

  await shot(page, "pill-1024");
});

test("not in fullscreen", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(QUIET_PAGE);
  await page.evaluate(() => {
    Object.defineProperty(document, "fullscreenElement", { value: document.body, configurable: true });
  });
  await waitForFirstPoll(page);

  await someonePosted(page, { text: "Posted while the viewer is watching fullscreen" });
  await page.waitForTimeout(5_000);

  await expect(page.locator('[data-testid="community-toast"]')).toHaveCount(0);
});

test("not while a pre-roll is pending", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(QUIET_PAGE);
  await page.evaluate(() => {
    const marker = document.createElement("div");
    marker.setAttribute("data-preroll", "pending");
    document.body.appendChild(marker);
  });
  await waitForFirstPoll(page);

  await someonePosted(page, { text: "Posted while the pre-roll is still counting down" });
  await page.waitForTimeout(5_000);

  await expect(page.locator('[data-testid="community-toast"]')).toHaveCount(0);
});

test("setting off means no bar at all", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.addInitScript(() => {
    window.localStorage.setItem("kumori.community.toasts", "0");
  });
  await page.goto(QUIET_PAGE);
  await page.locator('[data-testid="community-toast-host"]').waitFor({ state: "attached" });
  await waitForFirstPoll(page);

  await someonePosted(page, { text: "Posted while the reader turned the bar off" });
  await page.waitForTimeout(5_000);

  await expect(page.locator('[data-testid="community-toast"]')).toHaveCount(0);
});

test("nothing of Phase 4 exists with the flag off", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(`${OFF}${QUIET_PAGE}`);
  await expect(page.locator('[data-testid="community-toast-host"]')).toHaveCount(0);

  const api = await page.request.get(`${OFF}/api/community/latest?after=2026-01-01T00:00:00Z`);
  expect(api.status()).toBe(404);
  const admin = await page.request.get(`${OFF}/api/community/admin/announcements`);
  expect([404, 405]).toContain(admin.status());
});

test("the composer writes the sample announcement at 1280, and it publishes", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await signInAsAdmin(page);

  await page.goto("/community/admin/announcements");
  await expect(page.locator('[data-testid="composer-title"]')).toBeVisible();

  await page.fill('[data-testid="composer-title"]', SAMPLE_TITLE);
  await page.fill('[data-testid="composer-body"]', SAMPLE_BODY);

  // The preview is the real renderer: one h2, bold, and an autolink.
  const preview = page.locator('[data-testid="composer-preview"]');
  const rendered = preview.locator('[data-markdown-body="true"]');
  await expect(rendered.locator("h2")).toHaveText("Service Update: KumoriTV Is Back Online!");
  await expect(rendered.locator("strong").first()).toBeVisible();
  await expect(rendered.locator("a[href='https://kumoritv.top']")).toBeVisible();
  await shot(page, "composer-desktop-1280");

  await page.click('[data-testid="composer-publish"]');
  const confirm = page.locator('[data-testid="composer-confirm"]');
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText("A push notification will be sent");
  await shot(page, "composer-confirm-1280");

  await page.click('[data-testid="composer-confirm-publish"]');
  await expect(page.locator('[data-testid="composer-notice"]')).toBeVisible({ timeout: 15_000 });

  // The public index carries it, and the detail page renders the Markdown.
  await page.goto("/community/announcements");
  await expect(page.getByText(SAMPLE_TITLE).first()).toBeVisible();
  await shot(page, "announcements-index-1280");

  await page.getByText(SAMPLE_TITLE).first().click();
  await page.waitForURL(/\/community\/announcements\/[0-9a-f-]{36}/);
  const body = page.locator("[data-markdown-body='true']").first();
  await expect(body.locator("h2")).toHaveText("Service Update: KumoriTV Is Back Online!");
  await expect(body.locator("blockquote")).toHaveCount(0);
  await expect(body.locator("p").first()).toContainText("We are pleased to announce");
  await shot(page, "announcement-sample-1280");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "the rendered body never overflows").toBeLessThanOrEqual(0);
});

test("the composer at 360: tabs, no overflow, and a readable preview", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await signInAsAdmin(page);
  await page.goto("/community/admin/announcements");

  await page.fill('[data-testid="composer-title"]', "A phone-sized announcement");
  await page.fill('[data-testid="composer-body"]', `${SAMPLE_BODY}\n\nhttps://kumoritv.top/a/very/long/unbroken/path/that/should/wrap/and/never/cause/a/horizontal/scrollbar`);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "no horizontal overflow at 360").toBeLessThanOrEqual(0);

  const tabs = page.locator('[role="tab"]');
  await expect(tabs).toHaveCount(2);
  await tabs.nth(1).click();
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await shot(page, "composer-mobile-360-preview");

  await tabs.nth(0).click();
  await shot(page, "composer-mobile-360-write");
});

test("the sample announcement renders on a phone without overflow", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/community/announcements");
  await page.getByText(SAMPLE_TITLE).first().click();
  await page.waitForURL(/\/community\/announcements\/[0-9a-f-]{36}/);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await shot(page, "announcement-sample-360");
});
