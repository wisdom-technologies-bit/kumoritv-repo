// Prompt 31 browser check: measures every bug in the prompt against a real
// production build (`npx next build && npx next start -p 3100`).
//
//   1. home hero: logo above the meta line above the buttons, inside the
//      viewport, centred on phones;
//   2. stacking: header popovers (notifications, Settings modal) are the
//      topmost element at every sampled point, and the header/jump bar paint
//      over the episode badges;
//   3. watch page: friendly error copy (no raw JSON message), 320px fit,
//      DUB -> SUB switch, player fills its 16:9 box, compact Skip Intro;
//   4. media page: the Play pill opens the preferred audio.
//
// The real stream/skip/Supabase endpoints are unreachable from CI, so they are
// stubbed here (including an HTML 502 page, which is what produced
// `Unexpected token '<'`).
//
// Playwright is not a dependency of the site, so it is resolved at runtime:
//   PW_MODULE_PATH=/tmp/pw/node_modules node scripts/verify/prompt31-bugs.mjs
//
// Usage: node scripts/verify/prompt31-bugs.mjs [baseUrl] [--shots dir]

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);

const baseUrl =
  process.argv.find((arg) => arg.startsWith("http")) || "http://localhost:3100";
const shotsFlag = process.argv.indexOf("--shots");
const shotsDir = shotsFlag > -1 ? process.argv[shotsFlag + 1] : null;
if (shotsDir) mkdirSync(shotsDir, { recursive: true });

function loadPlaywright() {
  const candidates = [
    "playwright",
    process.env.PW_MODULE_PATH && join(process.env.PW_MODULE_PATH, "playwright"),
    "/tmp/pw/node_modules/playwright",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      /* try the next one */
    }
  }
  throw new Error(
    "Playwright not found. Install it or set PW_MODULE_PATH to a node_modules directory that has it.",
  );
}

const { chromium } = loadPlaywright();

const CHROME =
  process.env.PW_EXECUTABLE ||
  (existsSync("/root/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome")
    ? "/root/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome"
    : undefined);

const WEBM = (() => {
  const file = process.env.STUB_VIDEO || "/tmp/bb.webm";
  return existsSync(file) ? readFileSync(file) : null;
})();

const results = [];
async function check(label, fn) {
  try {
    const detail = await fn();
    results.push({ label, ok: true, detail });
    console.log(`  PASS  ${label}${detail ? ` - ${detail}` : ""}`);
  } catch (error) {
    results.push({ label, ok: false, detail: error.message });
    console.log(`  FAIL  ${label} - ${error.message}`);
  }
}

const round = (value) => Math.round(value * 100) / 100;

const WATCH_STREAM = {
  servers: [
    { id: "stub-1", label: "Server 1" },
    { id: "stub-2", label: "Server 2" },
  ],
  serverId: "stub-1",
  provider: "stub",
  hasBackup: true,
  availableAudio: ["sub", "dub"],
  stream: { type: "mp4", url: "/stub-video.webm" },
  subtitles: [],
  intro: { start: 0, end: 95 },
};

const USER = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "qa@example.com",
};
const SESSION = {
  access_token: "stub-token",
  token_type: "bearer",
  expires_in: 360000,
  expires_at: Math.floor(Date.now() / 1000) + 360000,
  refresh_token: "stub-refresh",
  user: {
    ...USER,
    aud: "authenticated",
    role: "authenticated",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { username: "QA" },
    identities: [],
    created_at: "2026-01-01T00:00:00Z",
  },
};
// @supabase/ssr keeps the session in a cookie, base64 encoded.
const AUTH_COOKIE =
  "base64-" + Buffer.from(JSON.stringify(SESSION)).toString("base64");

async function stub(page, { signIn = false, watchError = false } = {}) {
  if (signIn) {
    await page.context().addCookies([
      {
        name: "sb-localhost-auth-token",
        value: AUTH_COOKIE,
        domain: "localhost",
        path: "/",
        httpOnly: false,
        secure: false,
        sameSite: "Lax",
      },
    ]);
  }

  await page.route("**/api/watch/report", (route) =>
    route.fulfill({ status: 200, json: { ok: true } }),
  );

  await page.route(/\/api\/watch\/21\/\d+/, async (route) => {
    if (watchError) {
      return route.fulfill({
        status: 502,
        contentType: "text/html",
        body: "<!DOCTYPE html><html><body>502 Bad Gateway</body></html>",
      });
    }
    return route.fulfill({ status: 200, json: WATCH_STREAM });
  });

  await page.route("**/api/skip/**", (route) =>
    route.fulfill({ status: 200, json: { intro: { start: 0, end: 95 } } }),
  );

  if (WEBM) {
    await page.route("**/stub-video.webm", (route) =>
      route.fulfill({
        status: 200,
        contentType: "video/webm",
        body: WEBM,
      }),
    );
  }

  // TMDB wordmark: a wide image, so the "cut off at 390px" case is real.
  await page.route("**/image.tmdb.org/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 217"><rect width="1000" height="217" fill="transparent"/><text x="0" y="170" font-size="180" fill="white">BLACK CLOVER</text></svg>`,
    }),
  );

  await page.route("**/api/notifications**", (route) =>
    route.fulfill({ status: 200, json: { notifications: [], unread: 0, blocked: false } }),
  );
}

const rect = (page, selector) =>
  page
    .locator(selector)
    .first()
    .evaluate((node) => {
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        top: box.top + window.scrollY,
        bottom: box.bottom + window.scrollY,
        left: box.left + window.scrollX,
        right: box.right + window.scrollX,
        width: box.width,
        height: box.height,
        display: style.display,
        position: style.position,
        visibility: style.visibility,
      };
    });

/** Topmost element name at client coordinates, plus whether it is in `selector`. */
const topAt = (page, x, y, selector) =>
  page.evaluate(
    ([px, py, sel]) => {
      const hit = document.elementFromPoint(px, py);
      const container = document.querySelector(sel);
      return {
        inside: Boolean(container && hit && container.contains(hit)),
        top: hit
          ? `${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : ""}.${(hit.className || "")
              .toString()
              .split(" ")
              .filter(Boolean)
              .slice(0, 2)
              .join(".")}`
          : "none",
      };
    },
    [x, y, selector],
  );

function gridPoints(box, cols = 5, rows = 5) {
  const points = [];
  if (!box || !Number.isFinite(box.left) || !Number.isFinite(box.top)) return points;
  for (let i = 1; i <= cols; i += 1) {
    for (let j = 1; j <= rows; j += 1) {
      points.push([
        box.left + (box.width * i) / (cols + 1),
        box.top + (box.height * j) / (rows + 1),
      ]);
    }
  }
  return points;
}

async function openNotifications(page) {
  const bell = page.locator("[id*='notification_btn']").first();
  await bell.click();
  await page.waitForSelector("[id*='results_container']", { state: "visible" });
  await page.waitForTimeout(150);
  return page.locator("[id*='results_container']").first().evaluate((node) => {
    const box = node.getBoundingClientRect();
    return {
      top: box.top,
      left: box.left,
      bottom: box.bottom,
      right: box.right,
      width: box.width,
      height: box.height,
    };
  });
}

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ["--autoplay-policy=no-user-gesture-required"],
});

try {
  // ---------------------------------------------------------------- PART 1
  console.log("\n[1] HOME HERO");
  for (const [width, height] of [
    [390, 844],
    [1366, 768],
    [1920, 1080],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await stub(page);
    await page.goto(baseUrl + "/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector('img[class*="title_logo"]', { timeout: 15000 });
    await page.waitForTimeout(400);

    const logo = await rect(page, 'img[class*="title_logo"]');
    const meta = await rect(page, 'div[class*="item_info_inside"]');
    const buttons = await rect(page, 'div[class*="item_buttons"]');
    const container = await rect(page, 'div[class*="carousel_position_wrapper"]');
    const h2 = await rect(page, 'ul[class*="carousel_container"] li h2');

    console.log(
      `  ${width}x${height}: logo ${round(logo.width)}x${round(logo.height)} ` +
        `top ${round(logo.top)} bottom ${round(logo.bottom)} ` +
        `[${round(logo.left)}..${round(logo.right)}] pos=${logo.position} | ` +
        `meta top ${round(meta.top)} bottom ${round(meta.bottom)} | ` +
        `buttons top ${round(buttons.top)} | container [${round(container.left)}..${round(container.right)}]`,
    );

    await check(`1.${width} logo is in flow (not absolute)`, () => {
      assert.equal(logo.position, "static", `logo position is ${logo.position}`);
    });
    await check(`1.${width} logo.bottom <= meta.top`, () => {
      assert.ok(
        logo.bottom <= meta.top + 0.5,
        `logo.bottom ${round(logo.bottom)} > meta.top ${round(meta.top)} (overlap ${round(logo.bottom - meta.top)}px)`,
      );
    });
    await check(`1.${width} meta.bottom <= buttons.top`, () => {
      assert.ok(
        meta.bottom <= buttons.top + 0.5,
        `meta.bottom ${round(meta.bottom)} > buttons.top ${round(buttons.top)}`,
      );
    });
    await check(`1.${width} logo stays inside the viewport`, () => {
      assert.ok(
        logo.left >= 0 && logo.right <= width + 0.5,
        `logo spans ${round(logo.left)}..${round(logo.right)} of 0..${width}`,
      );
      assert.ok(logo.width <= container.width + 0.5, `logo ${round(logo.width)} wider than its box ${round(container.width)}`);
    });
    if (width < 768) {
      await check(`1.${width} logo and meta are centred on phones`, () => {
        const logoCentre = logo.left + logo.width / 2;
        const boxCentre = container.left + container.width / 2;
        const metaCentre = meta.left + meta.width / 2;
        assert.ok(
          Math.abs(logoCentre - boxCentre) <= 1,
          `logo centre ${round(logoCentre)} vs container centre ${round(boxCentre)}`,
        );
        assert.ok(
          Math.abs(metaCentre - boxCentre) <= 1,
          `meta centre ${round(metaCentre)} vs container centre ${round(boxCentre)}`,
        );
      });
    } else {
      // The column keeps the breakpoint's own alignment; what matters is that
      // the logo and the meta line agree - both centred or both on the left.
      await check(`1.${width} logo shares the meta line's alignment`, () => {
        const logoCentre = logo.left + logo.width / 2;
        const metaCentre = meta.left + meta.width / 2;
        const bothCentred =
          Math.abs(logoCentre - metaCentre) <= 2 &&
          Math.abs(logo.left - meta.left) <= Math.abs(logo.width - meta.width) + 2;
        const bothLeft = Math.abs(logo.left - meta.left) <= 2;
        assert.ok(
          bothCentred || bothLeft,
          `logo [${round(logo.left)}..${round(logo.left + logo.width)}] vs meta [${round(meta.left)}..${round(meta.left + meta.width)}]`,
        );
      });
    }
    const hiddenTitle = () =>
      page.locator('h2 span[class*="title_text_hidden"]').first().evaluate((node) => {
        const box = node.getBoundingClientRect();
        return { width: box.width, height: box.height, text: node.textContent };
      });
    await check(`1.${width} the hidden text title is still in the DOM`, async () => {
      const box = await hiddenTitle();
      assert.ok(box.text.trim().length > 0, "hidden title is empty");
      assert.ok(box.width <= 1.5 && box.height <= 1.5, `hidden title box ${box.width}x${box.height}`);
    });

    if (shotsDir) await page.screenshot({ path: `${shotsDir}/1-hero-${width}-logo.png` });

    // Same page with the logo failing to load: the text title takes its place.
    const noLogo = await browser.newPage({ viewport: { width, height } });
    await stub(noLogo);
    await noLogo.route("**/image.tmdb.org/**", (route) => route.abort());
    await noLogo.goto(baseUrl + "/", { waitUntil: "domcontentloaded" });
    await noLogo.waitForTimeout(1200);
    const textTitle = await rect(noLogo, 'ul[class*="carousel_container"] li h2');
    const textMeta = await rect(noLogo, 'div[class*="item_info_inside"]');
    await check(`1.${width} text-title fallback stays in flow`, () => {
      assert.ok(
        textTitle.bottom <= textMeta.top + 0.5,
        `title.bottom ${round(textTitle.bottom)} > meta.top ${round(textMeta.top)}`,
      );
    });
    if (shotsDir) await noLogo.screenshot({ path: `${shotsDir}/1-hero-${width}-text.png` });
    await noLogo.close();
    await page.close();
  }

  // ---------------------------------------------------------------- PART 2
  console.log("\n[2] STACKING (header above page content)");
  {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await stub(page, { signIn: true });
    await page.goto(baseUrl + "/watch/21?ep=1&audio=sub", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[id*='video_container']", { timeout: 20000 });
    await page.waitForTimeout(1500);

    const panel = await openNotifications(page);
    const failures = [];
    for (const [x, y] of gridPoints(panel)) {
      const hit = await topAt(page, x, y, "[id*='results_container']");
      if (!hit.inside) failures.push(`${round(x)},${round(y)} -> ${hit.top}`);
    }
    await check("2a watch page: notifications panel is topmost", () =>
      assert.equal(failures.length, 0, `${failures.length} points hit page content: ${failures.slice(0, 3).join(" | ")}`),
    );

    const panelBox = await page.locator("[id*='results_container']").first().boundingBox();
    const sidebarBox = await page.locator('aside[id*="sidebar"]').first().boundingBox();
    if (panelBox && sidebarBox) {
      const overlaps = !(
        panelBox.x + panelBox.width < sidebarBox.x ||
        sidebarBox.x + sidebarBox.width < panelBox.x ||
        panelBox.y + panelBox.height < sidebarBox.y ||
        sidebarBox.y + sidebarBox.height < panelBox.y
      );
      console.log(
        `  panel [${round(panelBox.x)}..${round(panelBox.x + panelBox.width)}]x[${round(panelBox.y)}..${round(panelBox.y + panelBox.height)}] ` +
          `sidebar [${round(sidebarBox.x)}..${round(sidebarBox.x + sidebarBox.width)}] overlaps=${overlaps}`,
      );
    }
    if (shotsDir) await page.screenshot({ path: `${shotsDir}/2-watch-notifications.png` });
    await page.close();
  }

  {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await stub(page, { signIn: true });
    await page.goto(baseUrl + "/media/21", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    const panel = await openNotifications(page);
    const failures = [];
    for (const [x, y] of gridPoints(panel)) {
      const hit = await topAt(page, x, y, "[id*='results_container']");
      if (!hit.inside) failures.push(`${round(x)},${round(y)} -> ${hit.top}`);
    }
    await check("2b media page: notifications panel is topmost", () =>
      assert.equal(failures.length, 0, `${failures.length} points hit page content: ${failures.slice(0, 3).join(" | ")}`),
    );
    if (shotsDir) await page.screenshot({ path: `${shotsDir}/2-media-jumpbar-vs-notifications.png` });
    await page.keyboard.press("Escape");

    // Settings modal from the user menu (fresh load: the panel above is open).
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await page.locator('button[aria-label="Click to Show User Menu"]').first().click();
    await page.waitForTimeout(250);
    const settings = page.getByRole("button", { name: /Settings/i }).first();
    await settings.click({ timeout: 5000 });
    await page.waitForSelector('div[id*="backdrop"]', { timeout: 8000 });
    await page.waitForTimeout(400);

    const modal = await page.locator('div[id*="backdrop"]').first().boundingBox();
    assert.ok(modal, "the Settings modal did not open");
    const modalFailures = [];
    for (const [x, y] of gridPoints(modal, 6, 6)) {
      const hit = await topAt(page, x, y, 'div[id*="backdrop"]');
      if (!hit.inside) modalFailures.push(`${round(x)},${round(y)} -> ${hit.top}`);
    }
    await check("2c media page: Settings modal is topmost over the hero buttons", () =>
      assert.equal(modalFailures.length, 0, `${modalFailures.length} points: ${modalFailures.slice(0, 3).join(" | ")}`),
    );
    if (shotsDir) await page.screenshot({ path: `${shotsDir}/2-media-settings-modal.png` });
    await page.keyboard.press("Escape");
    await page.locator('button[aria-label="Close Settings"], button[aria-label="Close"]').first().click().catch(() => {});

    // Scroll: header + jump bar must paint over the episode badges.
    await page.evaluate(() => window.scrollTo(0, 1500));
    await page.waitForTimeout(600);
    const headerBox = await page.locator("header[id*='background']").first().boundingBox();
    const badge = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll("section, article, li, div"));
      for (const node of nodes) {
        const text = (node.textContent || "").trim();
        if (!/^DUB$/.test(text)) continue;
        const box = node.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        if (box.top < 110 && box.bottom > 30) {
          return { x: box.left + box.width / 2, y: Math.max(box.top, 40) };
        }
      }
      return null;
    });
    if (!badge) console.log("  SKIP  2b episode badges: no badge in the header band with stubbed data");
    await check("2b episode badges never paint over the header after scrolling", () => {
      if (!badge) return "no badge to measure";
      assert.ok(badge, "no badge found in the header band");
      return page
        .evaluate(
          ([x, y]) => {
            const hit = document.elementFromPoint(x, y);
            const header = document.querySelector("header[id*='background']");
            return {
              insideHeader: Boolean(header && hit && header.contains(hit)),
              top: hit ? `${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : ""}` : "none",
            };
          },
          [badge.x, badge.y],
        )
        .then((hit) =>
          assert.ok(hit.insideHeader, `topmost at badge point is ${hit.top}, not the header`),
        );
    });
    console.log(`  header is ${headerBox ? round(headerBox.height) : "?"}px tall at 1366x768`);
    if (shotsDir) await page.screenshot({ path: `${shotsDir}/2-media-scrolled-badges.png` });
    await page.close();
  }

  // ---------------------------------------------------------------- PART 3a
  console.log("\n[3a] WATCH PAGE ERROR OVERLAY");
  {
    for (const width of [390, 320, 1366]) {
      const page = await browser.newPage({ viewport: { width, height: width < 768 ? 844 : 768 } });
      await stub(page, { watchError: true });
      await page.goto(baseUrl + "/watch/21?ep=1&audio=dub", { waitUntil: "domcontentloaded" });
      await page.waitForSelector('div[role="alert"]', { timeout: 20000 });
      await page.waitForTimeout(600);

      const text = (await page.locator('div[role="alert"]').first().innerText()).trim();
      console.log(`  ${width}px overlay copy: ${JSON.stringify(text.slice(0, 120))}`);
      await check(`3a.${width} overlay never shows the raw message`, () => {
        assert.ok(!/Unexpected token|DOCTYPE|not valid JSON|<html/i.test(text), `raw text leaked: ${text.slice(0, 80)}`);
        assert.ok(/isn't available|is not available/i.test(text), `unexpected copy: ${text.slice(0, 80)}`);
      });
      await check(`3a.${width} no horizontal overflow`, async () => {
        const sizes = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        }));
        assert.ok(
          sizes.scrollWidth <= sizes.innerWidth + 1,
          `document is ${sizes.scrollWidth}px wide in a ${sizes.innerWidth}px viewport`,
        );
      });
      await check(`3a.${width} overlay fits its player box`, async () => {
        const fit = await page.evaluate(() => {
          const alert = document.querySelector('div[role="alert"]');
          const box = alert.getBoundingClientRect();
          const inner = alert.firstElementChild?.getBoundingClientRect();
          return inner ? { inner: [inner.left, inner.right], box: [box.left, box.right] } : null;
        });
        assert.ok(fit, "overlay has no content box");
        assert.ok(
          fit.inner[0] >= fit.box[0] - 0.5 && fit.inner[1] <= fit.box[1] + 0.5,
          `content ${round(fit.inner[0])}..${round(fit.inner[1])} outside ${round(fit.box[0])}..${round(fit.box[1])}`,
        );
      });
      await check(`3a.${width} dub shows a Switch to Sub pill`, async () => {
        const box = await page
          .getByRole("button", { name: /Switch to Sub/i })
          .first()
          .evaluate((node) => {
            const rect = node.getBoundingClientRect();
            return { width: rect.width, height: rect.height };
          });
        assert.ok(box.width > 0 && box.height > 0, "Switch to Sub is not visible");
      });
      await check(`3a.${width} retry controls keep the word Retry`, async () => {
        const label = await page
          .getByRole("button", { name: /Retry|Try again/i })
          .first()
          .textContent();
        assert.ok(/retry|try again/i.test(label || ""), "no Retry control");
      });
      if (shotsDir) await page.screenshot({ path: `${shotsDir}/3a-error-dub-${width}.png` });
      await page.close();
    }

    // SUB: no DUB fallback, no auto-switch.
    const subPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await stub(subPage, { watchError: true });
    await subPage.goto(baseUrl + "/watch/21?ep=1&audio=sub", { waitUntil: "domcontentloaded" });
    await subPage.waitForSelector('div[role="alert"]', { timeout: 20000 });
    await subPage.waitForTimeout(700);
    await check("3a.sub no Switch to Sub in sub mode", async () =>
      assert.equal(await subPage.getByRole("button", { name: /Switch to Sub/i }).count(), 0),
    );
    if (shotsDir) await subPage.screenshot({ path: `${shotsDir}/3a-error-sub-390.png` });
    await subPage.close();

    // DUB, no servers: auto-switch to sub exactly once.
    const autoPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await stub(autoPage);
    await autoPage.unroute(/\/api\/watch\/21\/\d+/);
    await autoPage.route(/\/api\/watch\/21\/\d+/, (route) =>
      /audio=dub/.test(route.request().url())
        ? route.fulfill({
            status: 502,
            contentType: "text/html",
            body: "<!DOCTYPE html><html><body>502</body></html>",
          })
        : route.fulfill({ status: 200, json: WATCH_STREAM }),
    );
    const navs = [];
    autoPage.on("framenavigated", (frame) => {
      if (frame === autoPage.mainFrame()) navs.push(frame.url());
    });
    await autoPage.goto(baseUrl + "/watch/21?ep=1&audio=dub", { waitUntil: "domcontentloaded" });
    await autoPage.waitForTimeout(4500);
    const autoUrl = autoPage.url();
    console.log(`  auto-switch landed on ${autoUrl}`);
    await check("3a dub auto-switches to sub once", () => {
      assert.match(autoUrl, /audio=sub/, `still on ${autoUrl}`);
      const subVisits = navs.filter((url) => /audio=sub/.test(url)).length;
      assert.ok(subVisits <= 1, `navigated to sub ${subVisits} times`);
    });
    await autoPage.close();
  }

  // ---------------------------------------------------------------- PART 3b
  console.log("\n[3b] ANIME CARD ROUND BUTTONS");
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await stub(page);
    await page.goto(baseUrl + "/watch/21?ep=1&audio=sub", { waitUntil: "domcontentloaded" });
    await page.waitForSelector('div[class*="round_actions"]', { timeout: 20000 });
    await page.waitForTimeout(1200);

    const measure = () =>
      page.evaluate(() => {
        const row = document.querySelector('div[class*="round_actions"]');
        return Array.from(row.querySelectorAll(":scope > button")).map((button) => {
          const box = button.getBoundingClientRect();
          const style = getComputedStyle(button);
          const svg = button.querySelector("svg");
          const svgBox = svg ? svg.getBoundingClientRect() : null;
          const glyph = svg ? (() => {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            svg.querySelectorAll("path,rect,circle,polygon").forEach((shape) => {
              const b = shape.getBBox();
              minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
              maxX = Math.max(maxX, b.x + b.width); maxY = Math.max(maxY, b.y + b.height);
            });
            if (!Number.isFinite(minX)) return null;
            const scale = svgBox.width / 16;
            return {
              cx: svgBox.left + ((minX + maxX) / 2) * scale,
              cy: svgBox.top + ((minY + maxY) / 2) * scale,
            };
          })() : null;
          return {
            label: button.getAttribute("aria-label") || button.textContent.trim().slice(0, 12),
            width: box.width,
            height: box.height,
            radius: style.borderRadius,
            border: style.borderTopColor,
            borderWidth: style.borderTopWidth,
            background: style.backgroundColor,
            glyphOffsetX: glyph ? glyph.cx - (box.left + box.width / 2) : null,
            glyphOffsetY: glyph ? glyph.cy - (box.top + box.height / 2) : null,
            dataActive: button.dataset.active || null,
            dataAdded: button.dataset.added || null,
          };
        });
      });

    await page.locator('div[class*="round_actions"]').first().scrollIntoViewIfNeeded();
    const idle = await measure();
    console.log(
      "  idle: " +
        idle
          .map(
            (b) =>
              `${b.label} ${round(b.width)}x${round(b.height)} bg=${b.background} border=${b.border} glyph=(${b.glyphOffsetX === null ? "?" : round(b.glyphOffsetX)},${b.glyphOffsetY === null ? "?" : round(b.glyphOffsetY)})`,
          )
          .join(" | "),
    );

    await check("3b buttons are round and outlined (not white discs)", () => {
      for (const button of idle) {
        assert.equal(round(button.width), round(button.height), `${button.label} is not square`);
        assert.match(button.radius, /50%|999px/, `${button.label} radius ${button.radius}`);
        assert.notEqual(button.background, "rgb(255, 255, 255)", `${button.label} paints a white disc`);
      }
    });
    await check("3b idle buttons use the 1px white-25 border", () => {
      for (const button of idle) {
        assert.equal(button.borderWidth, "1px", `${button.label} border ${button.borderWidth}`);
        assert.match(button.border, /rgba\(255, 255, 255, 0\.25\)|rgba\(255,255,255,0\.25\)|255, 255, 255, 0.25/, `${button.label} border ${button.border}`);
      }
    });
    await check("3b idle glyph is centred within 1px", () => {
      for (const button of idle) {
        if (button.glyphOffsetX === null) continue;
        assert.ok(
          Math.abs(button.glyphOffsetX) <= 1 && Math.abs(button.glyphOffsetY) <= 1,
          `${button.label} glyph off centre by (${round(button.glyphOffsetX)}, ${round(button.glyphOffsetY)})`,
        );
      }
    });
    await check("3b buttons are 40px on desktop / 44px on phones", () => {
      for (const button of idle) {
        assert.ok(
          Math.abs(button.width - 44) <= 0.5 || Math.abs(button.width - 40) <= 0.5,
          `${button.label} is ${round(button.width)}px`,
        );
      }
    });
    if (shotsDir) await page.screenshot({ path: `${shotsDir}/3b-card-buttons-idle-390.png` });

    // Open the "+" menu: it must be inside the viewport and marked active.
    const plus = page.locator('div[class*="round_actions"] button').nth(1);
    await plus.click();
    await page.waitForTimeout(400);
    const menu = await page.evaluate(() => {
      const node = document.querySelector('[class*="user_media_status_list"], [class*="add_to_list"], [role="menu"]');
      if (!node) return null;
      const box = node.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        z: getComputedStyle(node).zIndex,
      };
    });
    await check('3b the "+" menu opens inside the viewport', () => {
      assert.ok(menu, "no list menu found");
      assert.ok(menu.left >= -1 && menu.right <= 391, `menu spans ${round(menu.left)}..${round(menu.right)}`);
      assert.ok(menu.top >= 0 && menu.bottom <= 845, `menu spans ${round(menu.top)}..${round(menu.bottom)}`);
    });
    const active = await measure();
    console.log(`  "+" active bg=${active[1].background}`);
    await check("3b the active state is a solid brand circle", () => {
      assert.match(active[1].background, /124, 92, 255|var\(--brand-color\)/, `active bg ${active[1].background}`);
    });
    if (shotsDir) await page.screenshot({ path: `${shotsDir}/3b-card-buttons-active-390.png` });

    // Forced favourites state (a guest click opens the login modal instead).
    // The button transitions its background, so measure with transitions off.
    await page.addStyleTag({ content: "* { transition: none !important; animation: none !important }" });
    // Read the paint in the SAME evaluate: a React re-render would otherwise
    // reset `data-added` before the measurement lands.
    const forced = await page.evaluate(() => {
      const row = document.querySelector('div[class*="round_actions"]');
      const heart =
        row.querySelector('button[aria-label*="Favourites"]') ||
        [...row.querySelectorAll(":scope > button")].at(-1);
      heart.setAttribute("data-added", "true");
      const style = getComputedStyle(heart);
      return {
        html: heart.outerHTML.slice(0, 220),
        bg: style.backgroundColor,
        bgImage: style.backgroundImage,
        cls: heart.className,
        attrs: heart.getAttribute("data-added"),
        html: heart.outerHTML.slice(0, 260),
      };
    });
    console.log(`  favourite active bg=${forced.bg}`);
    await check("3b a favourited heart is a brand circle too", () =>
      assert.match(forced.bg, /124, 92, 255/, `bg ${forced.bg}`),
    );
    if (shotsDir) await page.screenshot({ path: `${shotsDir}/3b-card-buttons-favourited-390.png` });

    await page.setViewportSize({ width: 1366, height: 768 });
    await page.waitForTimeout(600);
    const desktop = await measure();
    console.log(
      "  desktop: " +
        desktop.map((b) => `${b.label} ${round(b.width)}x${round(b.height)} bg=${b.background}`).join(" | "),
    );
    await check("3b desktop keeps the round outlined look", () => {
      for (const button of desktop) {
        assert.equal(round(button.width), round(button.height));
        assert.notEqual(button.background, "rgb(255, 255, 255)");
      }
    });
    if (shotsDir) await page.screenshot({ path: `${shotsDir}/3b-card-buttons-1366.png` });
    await page.close();
  }

  // ---------------------------------------------------------------- PART 3c
  console.log("\n[3c] PLAYER FILLS ITS 16:9 BOX");
  for (const [width, height] of [
    [1366, 768],
    [1536, 864],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await stub(page);
    await page.goto(baseUrl + "/watch/21?ep=1&audio=sub", { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-media-player]', { timeout: 20000 });
    await page.waitForTimeout(2000);

    const boxes = await page.evaluate(() => {
      const pick = (selector) => {
        const node = document.querySelector(selector);
        if (!node) return null;
        const box = node.getBoundingClientRect();
        return { width: box.width, height: box.height, top: box.top, left: box.left };
      };
      return {
        wrapper: pick("[id*='video_container']"),
        player: pick("[id*='video_container'] [data-media-player]"),
        provider: pick("[id*='video_container'] media-provider"),
        video: pick("[id*='video_container'] video"),
        poster: pick("[id*='video_container'] .vds-poster"),
        chain: (() => {
          const root = document.querySelector("[id*='video_container']");
          const rows = [];
          const walk = (node, depth) => {
            if (!node || depth > 4 || rows.length > 14) return;
            for (const child of node.children) {
              if (["SCRIPT", "STYLE"].includes(child.tagName)) continue;
              const box = child.getBoundingClientRect();
              const cs = getComputedStyle(child);
              rows.push(
                `${"—".repeat(depth)}${child.tagName.toLowerCase()}` +
                  `${child.className ? "." + String(child.className).split(" ")[0] : ""}` +
                  ` ${Math.round(box.width)}x${Math.round(box.height)} ar=${cs.aspectRatio}` +
                  ` b=${cs.borderTopWidth}/${cs.borderLeftWidth} p=${cs.paddingTop}/${cs.paddingLeft}` +
                  ` bs=${cs.boxSizing} d=${cs.display}`,
              );
              walk(child, depth + 1);
            }
          };
          walk(root, 1);
          return rows;
        })(),
      };
    });
    if (process.env.P31_DEBUG) console.log(boxes.chain.join("\n"));
    console.log(
      `  ${width}x${height} wrapper ${round(boxes.wrapper?.width)}x${round(boxes.wrapper?.height)} | ` +
        `player ${round(boxes.player?.width)}x${round(boxes.player?.height)} | ` +
        `provider ${round(boxes.provider?.width)}x${round(boxes.provider?.height)} | ` +
        `video ${round(boxes.video?.width)}x${round(boxes.video?.height)}`,
    );
    await check(`3c.${width} player fills the wrapper`, () => {
      assert.ok(boxes.player, "no player element");
      assert.ok(
        Math.abs(boxes.player.width - boxes.wrapper.width) <= 1 &&
          Math.abs(boxes.player.height - boxes.wrapper.height) <= 1,
        `player ${round(boxes.player.width)}x${round(boxes.player.height)} vs wrapper ${round(boxes.wrapper.width)}x${round(boxes.wrapper.height)}`,
      );
    });
    await check(`3c.${width} media element fills the wrapper`, () => {
      assert.ok(boxes.video, "no <video> element");
      assert.ok(
        Math.abs(boxes.video.width - boxes.wrapper.width) <= 1 &&
          Math.abs(boxes.video.height - boxes.wrapper.height) <= 1,
        `video ${round(boxes.video.width)}x${round(boxes.video.height)} vs wrapper ${round(boxes.wrapper.width)}x${round(boxes.wrapper.height)}`,
      );
    });
    await check(`3c.${width} wrapper keeps the 16:9 ratio`, () => {
      const ratio = boxes.wrapper.width / boxes.wrapper.height;
      assert.ok(Math.abs(ratio - 16 / 9) < 0.02, `ratio ${round(ratio)}`);
    });
    if (shotsDir) await page.screenshot({ path: `${shotsDir}/3c-player-${width}.png` });
    await page.close();
  }

  // ---------------------------------------------------------------- PART 3d
  console.log("\n[3d] SKIP INTRO PILL");
  for (const [width, height] of [
    [390, 844],
    [1366, 768],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await stub(page);
    await page.goto(baseUrl + "/watch/21?ep=1&audio=sub", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[id*='video_container'] video", { timeout: 25000 });
    await page.evaluate(async () => {
      const video = document.querySelector("[id*='video_container'] video");
      video.muted = true;
      try {
        video.currentTime = 5;
        await video.play();
      } catch {
        /* the pill check below reports the failure */
      }
    });
    await page.waitForSelector("[id*='skip_btn']", { timeout: 15000 });
    await page.evaluate(async () => {
      const video = document.querySelector("[id*='video_container'] video");
      video.pause();
      video.currentTime = 5;
      video.dispatchEvent(new Event("timeupdate"));
    });
    await page.waitForTimeout(500);
    const skipVisible = await page.locator("[id*='skip_btn']").first().isVisible();
    if (!skipVisible) {
      console.log(`  SKIP  3d.${width} skip pill not shown (video state unavailable in stub)`);
      await page.close();
      continue;
    }

    const metrics = await page.evaluate(() => {
      const skip = document.querySelector("[id*='skip_btn']");
      const player = document.querySelector("[id*='video_container'] [data-media-player]");
      const play = document.querySelector(
        '[data-media-player] .vds-play-button, [data-media-player] [data-part="play-button"], [data-media-player] .vds-big-play-button',
      );
      const box = (node) => {
        if (!node) return null;
        const r = node.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      };
      const style = getComputedStyle(skip);
      return {
        skip: box(skip),
        player: box(player),
        play: box(play),
        height: skip.getBoundingClientRect().height,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        radius: style.borderRadius,
        background: style.backgroundColor,
        text: (skip.textContent || "").trim(),
      };
    });
    console.log(
      `  ${width}x${height} skip ${round(metrics.skip.width)}x${round(metrics.skip.height)} at ` +
        `right gap ${round(metrics.player.right - metrics.skip.right)} bottom gap ${round(metrics.player.bottom - metrics.skip.bottom)} ` +
        `copy=${JSON.stringify(metrics.text)} radius=${metrics.radius} bg=${metrics.background}`,
    );
    await check(`3d.${width} skip pill is 34px tall`, () =>
      assert.ok(Math.abs(metrics.height - 34) <= 1, `height ${round(metrics.height)}`),
    );
    await check(`3d.${width} skip pill is bottom-right`, () => {
      const rightGap = metrics.player.right - metrics.skip.right;
      const bottomGap = metrics.player.bottom - metrics.skip.bottom;
      assert.ok(rightGap >= 6 && rightGap <= 20, `right gap ${round(rightGap)}`);
      assert.ok(bottomGap >= 40 && bottomGap <= 90, `bottom gap ${round(bottomGap)}`);
    });
    await check(`3d.${width} skip pill never covers the centre play button`, () => {
      if (!metrics.play) return "no play button measured";
      const a = metrics.skip;
      const b = metrics.play;
      const overlap = !(a.right < b.left || b.right < a.left || a.bottom < b.top || b.bottom < a.top);
      assert.ok(!overlap, `skip [${round(a.left)}..${round(a.right)}] overlaps play [${round(b.left)}..${round(b.right)}]`);
      return "no overlap";
    });
    await check(`3d.${width} skip pill copy is unchanged`, () =>
      assert.match(metrics.text, /Skip (Intro|Outro|Recap)/),
    );
    if (shotsDir) await page.screenshot({ path: `${shotsDir}/3d-skip-${width}.png` });
    await page.close();
  }

  // ---------------------------------------------------------------- PART 4
  console.log("\n[4] MEDIA PAGE PLAY BUTTON AUDIO");
  const playHref = async (page) => {
    await page.goto(baseUrl + "/media/21", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1400);
    await page.locator("[id*='watch_action'] button").first().click();
    await page.waitForURL(/\/watch\//, { timeout: 8000 });
    const url = page.url();
    return url;
  };
  {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await stub(page);
    const url = await playHref(page);
    console.log(`  pref off -> ${url}`);
    await check("4 pref off links with audio=sub", () => assert.match(url, /[?&]audio=sub\b/));
    await page.close();
  }
  {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await stub(page);
    await page.addInitScript(() => localStorage.setItem("dubEpisodes", "true"));
    const url = await playHref(page);
    console.log(`  pref on -> ${url}`);
    await check("4 pref on links with audio=dub", () => assert.match(url, /[?&]audio=dub\b/));
    await page.close();
  }
  {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await stub(page);
    await page.addInitScript(() =>
      localStorage.setItem(
        "kumori_progress_v1",
        JSON.stringify({
          21: {
            episode: 3,
            time: 300,
            duration: 1440,
            audio: "dub",
            updatedAt: Date.now(),
            title: "One Piece",
          },
        }),
      ),
    );
    const url = await playHref(page);
    console.log(`  resume dub -> ${url}`);
    await check("4 resume dub record keeps audio=dub", () => assert.match(url, /[?&]audio=dub\b/));
    await page.close();
  }
} finally {
  await browser.close();
}

const failed = results.filter((item) => !item.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed` +
    (failed.length ? `\nFAILED:\n${failed.map((item) => `  - ${item.label}: ${item.detail}`).join("\n")}` : ""),
);
process.exit(failed.length ? 1 : 0);
