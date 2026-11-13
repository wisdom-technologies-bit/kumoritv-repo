// Prompt 36: numeric audit of the clip page details block (no screenshots).
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const CLIP = process.env.CLIP_CODE || "93xjyak";
const audit = () => {
  const q = (s) => document.querySelector(s);
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const info = q("main > section");
  const cs = info && getComputedStyle(info);
  const actions = [...document.querySelectorAll("main > section a[data-testid], main > section a, main > section button")]
    .map((el) => ({ text: el.textContent.trim().slice(0, 24), ...box(el), top: Math.round(el.getBoundingClientRect().top) }));
  const smallText = [...document.querySelectorAll("main *")]
    .filter((el) => el.textContent.trim() && el.children.length === 0)
    .map((el) => ({ size: parseFloat(getComputedStyle(el).fontSize), text: el.textContent.trim().slice(0, 24) }))
    .filter((t) => t.size < 12);
  const poster = box(q("main > section a img") || q("main > section img"));
  const player = box(q("[data-media-player]"));
  return {
    player,
    info: { ...box(info), display: cs.display, position: cs.position, padding: cs.padding, radius: cs.borderRadius, bg: cs.backgroundColor, maxWidth: cs.maxWidth },
    gapToPlayer: player && info ? Math.round(info.y - (player.y + player.h)) : null,
    actionRows: new Set(actions.map((a) => a.top)).size,
    actions,
    poster,
    smallestText: smallText.slice(0, 6),
    docScroll: [document.documentElement.scrollWidth, window.innerWidth],
  };
};

const browser = await chromium.launch();
for (const vp of [
  { name: "360x800", width: 360, height: 800 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1440x900", width: 1440, height: 900 },
]) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await context.newPage();
  await page.goto(`${BASE}/clip/${CLIP}`, { waitUntil: "domcontentloaded" });
  await page.locator("[data-media-player]").waitFor({ timeout: 60_000 });
  await page.waitForTimeout(2500);
  console.log(vp.name, JSON.stringify(await page.evaluate(audit), null, 1));
  await context.close();
}
await browser.close();
