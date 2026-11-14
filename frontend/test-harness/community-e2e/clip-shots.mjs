// Prompt 38F: the composer clip picker, photographed and measured.
//
// Why not Playwright's test runner for this one: the picker needs a signed-in
// page, and NEXT_PUBLIC_SUPABASE_URL is inlined at BUILD time, so the browser
// only talks to the stand-in when the build itself was made with the stand-in
// URL. Build once with those values, start the stand-in and `next start`, then:
//
//   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54329 \
//   NEXT_PUBLIC_SUPABASE_ANON_KEY=standin-anon-key npx next build
//   STUB_PORT=54329 node test-harness/community-e2e/stub.mjs &
//   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54329 \
//   NEXT_PUBLIC_SUPABASE_ANON_KEY=standin-anon-key npx next start -p 3100 &
//   node test-harness/community-e2e/clip-shots.mjs
//
// The session cookie is the one @supabase/ssr reads on the client
// (sb-<project-ref>-auth-token); the stand-in accepts any bearer token on
// /auth/v1/user and sends CORS headers so the browser can call it directly.
import { chromium } from "../../node_modules/@playwright/test/index.mjs";
import { mkdirSync } from "node:fs";

const OUT = "test-harness/community-e2e/screenshots";
mkdirSync(OUT, { recursive: true });
const APP = process.env.APP_URL ?? "http://127.0.0.1:3100";
const USER = "10000000-0000-4000-8000-000000000101";

function session() {
  return {
    access_token: "standin.access.token", token_type: "bearer", expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "r",
    user: { id: USER, aud: "authenticated", role: "authenticated", email: "a@example.test",
      is_anonymous: false, user_metadata: { display_name: "Adaeze", username: "adaeze" } },
  };
}

async function context(browser, viewport) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addCookies([
    { name: "standin-user", value: "1", domain: "127.0.0.1", path: "/" },
    { name: "sb-127-auth-token", value: JSON.stringify(session()), domain: "127.0.0.1", path: "/" },
  ]);
  return ctx;
}

const log = (...args) => console.log(...args);
const browser = await chromium.launch();

// ---------------------------------------------------------------- desktop ---
{
  const ctx = await context(browser, { width: 1440, height: 900 });
  const page = await ctx.newPage();
  await page.goto(`${APP}/community`);
  await page.waitForSelector("[data-composer='inline']");
  await page.getByRole("button", { name: "Add clip" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add a clip" });
  await dialog.waitFor({ state: "visible" });
  await page.locator("[data-clip-picker] button[data-autofocus='true']").waitFor({ timeout: 20000 });
  await page.screenshot({ path: `${OUT}/phase3-picker-desktop.png` });

  const names = await page.locator("[data-clip-picker] li").allInnerTexts();
  log("rows:", JSON.stringify(names));
  const imgs = await page.locator("[data-clip-picker] li img").count();
  const adultRow = page.locator("[data-clip-picker] li").filter({ hasText: "Adult content 18+" });
  log("adult rows:", await adultRow.count(), "| imgs in picker:", imgs,
      "| adult row imgs:", await adultRow.locator("img").count(),
      "| adult row text:", JSON.stringify((await adultRow.innerText()).replace(/\n/g, " | ")));
  log("adult title leaked:", (await adultRow.innerText()).includes("Adult Title"));

  await page.locator("[data-clip-picker] li").filter({ hasText: "Frieren" }).getByRole("button").click();
  await page.locator("[data-clip-attachment='true']").waitFor();
  await page.screenshot({ path: `${OUT}/phase3-composer-preview.png` });
  const postBtn = page.getByRole("button", { name: "Post", exact: true });
  log("attachment text:", JSON.stringify((await page.locator("[data-clip-attachment='true']").innerText()).replace(/\n/g, " | ")));
  log("Post enabled with empty text:", await postBtn.isEnabled());

  // Now the adult clip: the author's own preview is masked too.
  await page.getByRole("button", { name: /Clip attached/ }).first().click();
  await page.locator("[data-clip-picker] li").filter({ hasText: "Adult content 18+" }).getByRole("button").click();
  await page.locator("[data-clip-attachment='true']").waitFor();
  log("adult attachment imgs:", await page.locator("[data-clip-attachment='true'] img").count(),
      "| text:", JSON.stringify((await page.locator("[data-clip-attachment='true']").innerText()).replace(/\n/g, " | ")));
  await page.screenshot({ path: `${OUT}/phase3-composer-preview-adult.png` });

  // paste tab: the chip has become "Clip attached", so reopen through it
  await page.getByRole("button", { name: /Clip attached/ }).first().click();
  await page.getByRole("tab", { name: "Paste clip URL" }).click();
  await page.getByLabel("Clip link or code").fill("https://kumoritv.top/clip/abc2345");
  await page.getByRole("button", { name: "Attach this clip" }).waitFor({ timeout: 20000 });
  await page.screenshot({ path: `${OUT}/phase3-picker-paste.png` });
  log("paste preview:", JSON.stringify((await page.locator("[data-clip-picker] [role='tabpanel']").innerText()).replace(/\n/g, " | ")));

  await page.getByLabel("Clip link or code").fill("https://kumoritv.top.evil.com/clip/abc2345");
  await page.waitForTimeout(800);
  const panel = page.locator("[data-clip-picker] [role='tabpanel']");
  log("lookalike panel:", JSON.stringify((await panel.innerText()).replace(/\n/g, " | ")));
  log("attach btn while refused:", await page.getByRole("button", { name: "Attach this clip" }).count());

  // Escape closes and focus returns to the chip
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  log("dialog after Escape:", await page.getByRole("dialog", { name: "Add a clip" }).count(),
      "| focus on Add clip:", await page.evaluate(() => document.activeElement?.textContent?.trim()));

  // paste inside the composer
  await page.reload();
  await page.waitForSelector("[data-composer='inline']");
  const area = page.locator("textarea[aria-label='Write a post']");
  await area.click();
  await area.evaluate((el) => {
    const data = new DataTransfer();
    data.setData("text/plain", "this fight https://kumoritv.top/clip/abc2345 is unreal");
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await page.locator("[data-clip-attachment='true']").waitFor({ timeout: 20000 });
  log("text after paste:", JSON.stringify(await area.inputValue()),
      "| note:", await page.getByText("Clip attached").first().isVisible());
  await page.screenshot({ path: `${OUT}/phase3-paste-in-composer.png` });

  // draft keeps the attachment
  const draft = await page.evaluate(() => window.localStorage.getItem("kumori:community:draft"));
  log("draft:", (draft ?? "").slice(0, 120));
  await ctx.close();
}

// ----------------------------------------------------------------- mobile ---
{
  const ctx = await context(browser, { width: 360, height: 800 });
  const page = await ctx.newPage();
  await page.goto(`${APP}/community`);
  await page.getByRole("button", { name: "Write a post" }).click();
  const sheet = page.getByRole("dialog", { name: "New post" });
  await sheet.waitFor();
  await sheet.getByRole("button", { name: "Add clip" }).click();
  await page.getByRole("dialog", { name: "Add a clip" }).waitFor();
  await page.locator("[data-clip-picker] button[data-autofocus='true']").waitFor({ timeout: 20000 });
  await page.screenshot({ path: `${OUT}/phase3-picker-mobile.png` });
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  const tab = await page.getByRole("tab", { name: "My recent clips" }).boundingBox();
  log("mobile overflow:", m.sw, "<=", m.iw, "| tab height:", tab?.height);
  await ctx.close();
}

await browser.close();
