// Part G: the parts of the push path that can be proven without a device.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import {
  oneSignalInitOptions,
  pushConfigured,
  PUSH_WORKER_PATH,
  PUSH_WORKER_SCOPE,
} from "../config";
import { buildNotificationPayload, chunkIds } from "../onesignal";

const projectFile = (path: string) => readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");

test("both service workers exist at the custom path and import the v16 SDK", () => {
  const worker = projectFile(`public/${PUSH_WORKER_PATH}`);
  assert.match(worker, /cdn\.onesignal\.com\/sdks\/web\/v16\/OneSignalSDK\.sw\.js/);
  assert.ok(existsSync(new URL("../../../../public/push/onesignal/OneSignalSDKUpdaterWorker.js", import.meta.url)));
  assert.equal(PUSH_WORKER_SCOPE, "/push/onesignal/");
});

test("next.config allows the worker its own scope and does not cache it", () => {
  const config = projectFile("next.config.mjs");
  assert.match(config, /source: '\/push\/onesignal\/:path\*'/);
  assert.match(config, /Service-Worker-Allowed', value: '\/push\/onesignal\/'/);
  assert.match(config, /public, max-age=0, must-revalidate/);
});

test("middleware never intercepts push/ (a rewritten worker is an HTML response)", () => {
  const middleware = projectFile("middleware.ts");
  assert.match(middleware, /matcher: \["\/\(\(\?!_next\/static\|_next\/image\|favicon\.ico\|push\/\)\.\*\)"\]/);
});

test("there is no CSP that could block cdn.onesignal.com", () => {
  for (const file of ["next.config.mjs", "middleware.ts"]) {
    assert.doesNotMatch(projectFile(file), /Content-Security-Policy/i, file);
  }
});

test("init is quiet: no bell, no autoprompt, only the toggle asks", () => {
  const config = projectFile("app/lib/push/config.ts");
  assert.match(config, /notifyButton: \{ enable: false \}/);
  assert.match(config, /autoPrompt: false/);
  const options = oneSignalInitOptions("app-id", false);
  assert.equal(options.serviceWorkerPath, PUSH_WORKER_PATH);
  assert.deepEqual(options.serviceWorkerParam, { scope: PUSH_WORKER_SCOPE });
  assert.equal(options.allowLocalhostAsSecureOrigin, false);
});

test("a missing app id is reported as missing, never guessed", () => {
  const before = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
  delete process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
  try {
    assert.equal(pushConfigured(), false);
  } finally {
    if (before === undefined) delete process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
    else process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID = before;
  }
});

test("the send payload is the documented OneSignal shape and carries no key", () => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://kumoritv.top";
  const payload = buildNotificationPayload({
    appId: "public-app-id",
    externalIds: ["user-1", "user-2"],
    title: "New episode",
    body: "Ep 3 is up",
    url: "/watch/1",
    image: "https://cdn.example/cover.jpg",
    topic: "episode-1",
    idempotencyKey: "outbox-7",
    chunkIndex: 2,
  });

  assert.equal(payload.app_id, "public-app-id");
  assert.equal(payload.target_channel, "push");
  assert.deepEqual(payload.include_aliases, { external_id: ["user-1", "user-2"] });
  assert.deepEqual(payload.headings, { en: "New episode" });
  assert.deepEqual(payload.contents, { en: "Ep 3 is up" });
  assert.equal(payload.url, "https://kumoritv.top/watch/1");
  assert.equal(payload.chrome_web_icon, "https://cdn.example/cover.jpg");
  assert.equal(payload.big_picture, "https://cdn.example/cover.jpg");
  assert.equal(payload.web_push_topic, "episode-1");
  assert.equal(payload.idempotency_key, "outbox-7:2");

  const serialised = JSON.stringify(payload);
  assert.doesNotMatch(serialised, /onesignal_rest_api_key|authorization|api[_-]?key/i);
  // OneSignal accepts at most 2000 ids per request.
  assert.equal(chunkIds(Array.from({ length: 4500 }, (_, i) => `u${i}`)).length, 3);
});
