// Phase 6, part G: the moderation surface, photographed at three widths, plus a
// keyboard-only pass over the one control a moderator uses most.
//
// Same shape as clip-shots.mjs and for the same reason: NEXT_PUBLIC_SUPABASE_URL
// is inlined at BUILD time, so the browser only reaches the stand-in when the
// build was made with the stand-in URL. Build, start, then run this.
//
//   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54329 \
//   NEXT_PUBLIC_SUPABASE_ANON_KEY=standin-anon-key npx next build
//   STUB_PORT=54329 node test-harness/community-e2e/stub.mjs &
//   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54329 \
//   NEXT_PUBLIC_SUPABASE_ANON_KEY=standin-anon-key \
//   SUPABASE_SERVICE_ROLE_KEY=standin-service-key COMMUNITY_ENABLED=1 \
//   npx next start -p 3100 &
//   node test-harness/community-e2e/phase6-shots.mjs
import { chromium } from "../../node_modules/@playwright/test/index.mjs";
import { mkdirSync } from "node:fs";

const OUT = "test-harness/community-e2e/screenshots";
mkdirSync(OUT, { recursive: true });
const APP = process.env.APP_URL ?? "http://127.0.0.1:3100";
const USER = "10000000-0000-4000-8000-000000000101";

const session = () => ({
  access_token: "standin.access.token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: "r",
  user: {
    id: USER,
    aud: "authenticated",
    role: "authenticated",
    email: "mod@example.test",
    is_anonymous: false,
    user_metadata: { display_name: "Adaeze", username: "adaeze" },
  },
});

async function context(browser, viewport) {
  const ctx = await browser.newContext({ viewport, reducedMotion: "reduce" });
  await ctx.addCookies([
    { name: "standin-user", value: "1", domain: "127.0.0.1", path: "/" },
    { name: "sb-127-auth-token", value: JSON.stringify(session()), domain: "127.0.0.1", path: "/" },
  ]);
  return ctx;
}

const PAGES = [
  ["dashboard", "/community/admin"],
  ["reports", "/community/admin/reports"],
  ["clips", "/community/admin/clips"],
  ["log", "/community/admin/log"],
];

const log = (...args) => console.log(...args);
const browser = await chromium.launch();
const problems = [];

for (const [name, width, height] of [
  ["mobile", 360, 780],
  ["tablet", 768, 1024],
  ["desktop", 1280, 900],
]) {
  const ctx = await context(browser, { width, height });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  for (const [slug, path] of PAGES) {
    const response = await page.goto(`${APP}${path}`, { waitUntil: "networkidle" });
    const status = response?.status() ?? 0;
    const body = await page.locator("body").innerText();
    if (status !== 200) problems.push(`${name} ${path}: HTTP ${status}`);
    if (/not found|404/i.test(body.slice(0, 200))) problems.push(`${name} ${path}: looks like a 404 page`);
    await page.screenshot({ path: `${OUT}/phase6-${slug}-${name}.png`, fullPage: true });
    log(`${name.padEnd(7)} ${path.padEnd(28)} HTTP ${status} | ${body.split("\n").filter(Boolean).length} lines`);
  }

  if (errors.length > 0) problems.push(`${name}: page errors ${errors.join("; ")}`);
  await ctx.close();
}

// --------------------------------------------------------------- keyboard ---
// The Restore control must be reachable with Tab alone and fire on Enter.
{
  const ctx = await context(browser, { width: 1280, height: 900 });
  const page = await ctx.newPage();
  await page.goto(`${APP}/community/admin/reports`, { waitUntil: "networkidle" });

  const restore = page.getByRole("button", { name: /restore/i }).first();
  const exists = (await restore.count()) > 0;
  log("restore controls on the inbox:", await restore.count());

  if (exists) {
    // Walk the tab order to the control rather than calling focus(), which is
    // what a keyboard user actually does.
    let reached = false;
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(() => {
        const el = document.activeElement;
        return { tag: el?.tagName ?? "", text: (el?.textContent ?? "").trim().slice(0, 40) };
      });
      if (/restore/i.test(focused.text)) {
        reached = true;
        log("tabbed to:", focused.tag, JSON.stringify(focused.text));
        break;
      }
    }
    if (!reached) problems.push("keyboard: Restore never received focus within 40 tabs");

    const calls = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/community/admin/")) calls.push(request.method());
    });

    // Restore is deliberately two-step (no single-click destructive action), so
    // the keyboard path is: Enter on Restore, then Tab to the confirm and Enter.
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    const confirmVisible = await page.getByRole("button", { name: /yes, restore/i }).count();
    log("confirm step appeared:", confirmVisible > 0);

    let confirmed = false;
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press("Tab");
      const text = await page.evaluate(() => (document.activeElement?.textContent ?? "").trim());
      if (/yes, restore/i.test(text)) {
        confirmed = true;
        log("tabbed to confirm:", JSON.stringify(text));
        break;
      }
    }
    if (!confirmed) problems.push("keyboard: the confirm step was not reachable with Tab");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1500);
    log("requests after Enter:", JSON.stringify(calls));
    if (calls.length === 0) problems.push("keyboard: Enter on the confirm sent no request");
    await page.screenshot({ path: `${OUT}/phase6-keyboard-restore.png`, fullPage: true });
  } else {
    problems.push("keyboard: no Restore control on the inbox page");
  }
  await ctx.close();
}

await browser.close();

if (problems.length > 0) {
  log("\nPROBLEMS:");
  for (const problem of problems) log(" -", problem);
  process.exitCode = 1;
} else {
  log("\nall screenshots captured, keyboard path clean");
}
