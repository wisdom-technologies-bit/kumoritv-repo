// Prompt 35: Playwright against a real `next start`.
//
// `STUB_PORT` is a LOCAL STAND-IN for Supabase Auth/PostgREST, AniList and the
// provider (see stub.mjs): no real Supabase, no real AniList, no real provider
// and no real video host is contacted. The app itself is the real production
// build (`next build` + `next start`).
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const ROOT = path.resolve(__dirname, "../..");

const PORT = Number(process.env.E2E_PORT || 3100);
const STUB_PORT = Number(process.env.STUB_PORT || 54321);

export default defineConfig({
  testDir: ".",
  testMatch: "clips.spec.ts",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "off",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `node test-harness/clips-e2e/stub.mjs`,
      cwd: ROOT,
      url: `http://127.0.0.1:${STUB_PORT}/subs.vtt`,
      reuseExistingServer: true,
      timeout: 30_000,
      env: { STUB_PORT: String(STUB_PORT) },
    },
    {
      command: `node_modules/.bin/next start -p ${PORT}`,
      cwd: ROOT,
      url: `http://127.0.0.1:${PORT}/`,
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        PORT: String(PORT),
        NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${STUB_PORT}`,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "stand-in-anon-key",
        SUPABASE_SERVICE_ROLE_KEY: "stand-in-service-key",
        ANILIST_API_URL: `http://127.0.0.1:${STUB_PORT}/`,
        ANIVEXA_BASE_URL: `http://127.0.0.1:${STUB_PORT}`,
        NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${PORT}`,
        NEXT_PUBLIC_WEBSITE_ORIGIN_URL: `http://127.0.0.1:${PORT}`,
      },
    },
  ],
});
