process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54329";
process.env.SUPABASE_SERVICE_ROLE_KEY = "standin-service-key";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "standin-anon-key";
process.env.COMMUNITY_ENABLED = "1";
const mod = await import("./.next/server/app/api/community/latest/route.js");
const GET =
  mod.GET ??
  mod.routeModule?.userland?.GET ??
  mod.default?.routeModule?.userland?.GET ??
  mod.routeModule?.userland?.routeModule?.userland?.GET;
console.log("keys", Object.keys(mod), typeof GET);
const url = "http://x/api/community/latest?limit=5&after=" + encodeURIComponent("2026-11-17T16:51:56.673Z");
const a = await GET(new Request(url));
console.log("1st", a.status, (await a.text()).slice(0, 80));
await new Promise((r) => setTimeout(r, 11000));
const logBefore = (await import("node:fs")).readFileSync("/tmp/stub.log", "utf8").length;
const b = await GET(new Request(url));
const body = await b.text();
console.log("2nd", b.status, body.slice(0, 80));
const logAfter = (await import("node:fs")).readFileSync("/tmp/stub.log", "utf8").length;
console.log("stub log grew:", logAfter > logBefore);
