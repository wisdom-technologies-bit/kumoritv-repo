// Prompt 38B: Playwright against the real production build.
//
// Two Next servers share one build: 3100 runs with COMMUNITY_ENABLED=1 (the
// feature on) and 3101 with it unset (the feature off, which must 404 and leave
// the bell and footer untouched). Supabase is the local stub - no real project,
// no AniList, no provider.
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const ROOT = path.resolve(__dirname, "../..");

const PORT = Number(process.env.E2E_PORT || 3100);
const OFF_PORT = PORT + 1;
const STUB_PORT = Number(process.env.STUB_PORT || 54329);

const baseEnv = {
  NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${STUB_PORT}`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "standin-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "standin-service-key",
  ANILIST_API_URL: `http://127.0.0.1:${STUB_PORT}/`,
  PROXY_SIGNING_SECRET: "standin-proxy-secret",
  NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${PORT}`,
  NEXT_PUBLIC_WEBSITE_ORIGIN_URL: `http://127.0.0.1:${PORT}`,
};

export default defineConfig({
  testDir: ".",
  testMatch: "community.spec.ts",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "off",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node test-harness/community-e2e/stub.mjs",
      cwd: ROOT,
      url: `http://127.0.0.1:${STUB_PORT}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { STUB_PORT: String(STUB_PORT) },
    },
    {
      command: `node_modules/.bin/next start -p ${PORT}`,
      cwd: ROOT,
      url: `http://127.0.0.1:${PORT}/community`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { ...baseEnv, PORT: String(PORT), COMMUNITY_ENABLED: "1" },
    },
    {
      command: `node_modules/.bin/next start -p ${OFF_PORT}`,
      cwd: ROOT,
      url: `http://127.0.0.1:${OFF_PORT}/`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { ...baseEnv, PORT: String(OFF_PORT), COMMUNITY_ENABLED: "" },
    },
  ],
});
