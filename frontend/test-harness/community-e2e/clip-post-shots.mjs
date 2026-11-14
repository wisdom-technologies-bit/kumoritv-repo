// Prompt 38F: the clip post card, the post page and the five-chip phone bar,
// photographed and measured. Same run order as clip-shots.mjs (build with the
// stand-in URL, start the stand-in and `next start`, then run this).
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

const browser = await chromium.launch();

// --------------------------------------------------------------- desktop ---
{
  const ctx = await context(browser, { width: 1440, height: 1000 });
  const page = await ctx.newPage();
  await page.goto(`${APP}/community`);
  await page.locator("[data-clip-post]").first().waitFor({ timeout: 30000 });
  // The cards mount in one paint but the counts are read separately, so let the
  // list settle before counting or the hidden/removed rows read as zero.
  await page.waitForTimeout(900);

  const live = page.locator("[data-clip-post='live']").first();
  const hidden = page.locator("[data-clip-post='hidden_adult']").first();
  const removed = page.locator("[data-clip-post='removed']").first();

  console.log("cards:", await page.locator("[data-clip-post]").count(),
    "| live:", await live.count(), "hidden:", await hidden.count(), "removed:", await removed.count());
  console.log("live href:", await live.getAttribute("href"),
    "| live title:", JSON.stringify(await live.locator("[class*='feed_clip_title']").innerText()),
    "| live meta:", JSON.stringify(await live.locator("[class*='feed_clip_meta']").innerText()),
    "| live poster:", await live.locator("img").count());
  console.log("hidden imgs:", await hidden.locator("img").count(),
    "| hidden links:", await hidden.locator("a").count(),
    "| hidden text:", JSON.stringify((await hidden.innerText()).replace(/\n/g, " | ")));
  const body = await page.content();
  console.log("Adult Title in page:", body.includes("Adult Title"),
    "| hidden slug in page:", body.includes("/clip/adult77"),
    "| removed text:", JSON.stringify(await removed.innerText()));

  await page.screenshot({ path: `${OUT}/phase3-feed-clip-cards.png`, fullPage: false });

  // the Clips chip narrows the feed to clip posts only
  // Desktop draws the filters as a nav list, not as tabs, so this clicks the
  // button by its label inside the nav.
  await page.getByRole("navigation").getByRole("button", { name: "Clips", exact: true }).click();
  await page.waitForTimeout(1200);
  console.log("after Clips chip: clip cards:", await page.locator("[data-clip-post]").count(),
    "| text cards:", await page.locator("article[data-feed-key]").count() - await page.locator("[data-clip-post]").count(),
    "| url:", page.url(), "(the chip filters in place; the URL only carries a filter on first load)");

  // post page: the live clip
  await page.goto(`${APP}/community/post/10000000-0000-4000-8000-000000000031`);
  await page.locator("[data-clip-post]").first().waitFor({ timeout: 30000 });
  const pageLive = page.locator("[data-clip-post='live']").first();
  console.log("post page href:", await pageLive.getAttribute("href"),
    "| poster:", await pageLive.locator("img").count());
  await page.screenshot({ path: `${OUT}/phase3-post-page-clip.png` });

  // post page: the adult clip, masked server-side
  await page.goto(`${APP}/community/post/10000000-0000-4000-8000-000000000032`);
  await page.waitForTimeout(1500);
  const pageHidden = page.locator("[data-clip-post='hidden_adult']");
  const adultHtml = await page.content();
  console.log("post page adult card:", await pageHidden.count(),
    "| imgs:", await pageHidden.locator("img").count(),
    "| links:", await pageHidden.locator("a").count(),
    "| 'Adult Title' in html:", adultHtml.includes("Adult Title"),
    "| '/clip/' in html:", adultHtml.includes("/clip/"),
    "| text:", JSON.stringify((await pageHidden.innerText()).replace(/\n/g, " | ")));
  await page.screenshot({ path: `${OUT}/phase3-post-page-adult.png` });
  await ctx.close();
}

// ---------------------------------------------------------------- mobile ---
{
  const ctx = await context(browser, { width: 360, height: 800 });
  const page = await ctx.newPage();
  await page.goto(`${APP}/community`);
  await page.locator("[data-clip-post]").first().waitFor({ timeout: 30000 });
  const chips = page.locator("[class*='mobile_bar'] [role='tab']");
  console.log("mobile chips:", await chips.count(),
    "| labels:", JSON.stringify(await chips.allInnerTexts()));
  const boxes = await chips.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  console.log("chip tops (one row when all equal):", JSON.stringify([...new Set(boxes)]), "| overflow:", m.sw, "<=", m.iw);
  await page.screenshot({ path: `${OUT}/phase3-mobile-five-chips.png` });
  await ctx.close();
}

await browser.close();
