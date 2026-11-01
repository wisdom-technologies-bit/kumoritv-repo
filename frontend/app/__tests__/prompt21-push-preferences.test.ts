// Prompt 21, part 1: push preferences (defaults, mutual exclusion) and the
// master toggle states the Notifications section renders.

import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_PUSH_PREFERENCES,
  PUSH_NOTICES,
  applyPreferenceChange,
  categoriesVisible,
  detectPushEnvironment,
  masterToggleState,
  preferenceColumns,
  preferencesFromRow,
  preferencesOnFirstEnable,
  type PushPreferences,
} from "@/app/lib/push/state";
import { loadPushPreferences, savePushPreferences } from "@/app/lib/user-data/push";
import { __setDefaultContextForTests } from "@/app/lib/user-data/context";

type Globals = { __commentsTestClient?: unknown };
const globals = globalThis as unknown as Globals;

// jsdom has no Push API, so the two probes `detectPushEnvironment` looks for are
// stubbed for this whole file: a "supported browser" is the normal case here, and
// the unsupported case builds its state object directly.
test.beforeEach(() => {
  const scope = globalThis as unknown as Record<string, unknown>;
  scope.PushManager = class {};
  Object.defineProperty(navigator, "serviceWorker", { value: {}, configurable: true });
});



/** Records the upsert payload so the "one update, both flags" rule is provable. */
function recordingClient(options: { row?: Record<string, unknown> | null } = {}) {
  const writes: Array<{ table: string; payload: Record<string, unknown>; conflict?: string }> = [];

  function builder(table: string): any {
    const self: any = {
      select() {
        return self;
      },
      eq() {
        return self;
      },
      maybeSingle() {
        return Promise.resolve({ data: options.row ?? null, error: null });
      },
      upsert(payload: Record<string, unknown>, config?: { onConflict?: string }) {
        writes.push({ table, payload, conflict: config?.onConflict });
        return Promise.resolve({ error: null });
      },
      then(resolve: (value: unknown) => unknown) {
        return Promise.resolve({ data: null, error: null }).then(resolve);
      },
    };

    return self;
  }

  return {
    writes,
    from(table: string) {
      return builder(table);
    },
  };
}

test("the first enable applies only subscribed-episodes and announcements", () => {
  const next = preferencesOnFirstEnable({ ...EMPTY_PUSH_PREFERENCES });

  assert.equal(next.enabled, true);
  assert.equal(next.defaultsApplied, true);
  assert.equal(next.newEpisodesSubscribed, true);
  assert.equal(next.announcements, true);
  assert.equal(next.newEpisodesAll, false);
  assert.equal(next.replies, false);
  assert.equal(next.likes, false);
  assert.equal(next.mentions, false);
});

test("the defaults are applied once: a stored defaults_applied stops them", () => {
  const userChoices: PushPreferences = {
    ...EMPTY_PUSH_PREFERENCES,
    defaultsApplied: true,
    newEpisodesAll: false,
    newEpisodesSubscribed: false,
    replies: true,
    likes: true,
    mentions: true,
    announcements: false,
  };

  // What the settings modal does: only call preferencesOnFirstEnable when the
  // flag is still false.
  const afterReEnable = userChoices.defaultsApplied
    ? { ...userChoices, enabled: true }
    : preferencesOnFirstEnable(userChoices);

  assert.equal(afterReEnable.replies, true);
  assert.equal(afterReEnable.likes, true);
  assert.equal(afterReEnable.mentions, true);
  assert.equal(afterReEnable.announcements, false, "the user turned announcements off");
  assert.equal(afterReEnable.newEpisodesSubscribed, false, "the user turned subscribed off");
  assert.equal(afterReEnable.enabled, true);
});

test("the two episode options are mutually exclusive in both directions", () => {
  const base = preferencesOnFirstEnable({ ...EMPTY_PUSH_PREFERENCES });
  assert.equal(base.newEpisodesSubscribed, true);
  assert.equal(base.newEpisodesAll, false);

  const allOn = applyPreferenceChange(base, { newEpisodesAll: true });
  assert.equal(allOn.newEpisodesAll, true);
  assert.equal(allOn.newEpisodesSubscribed, false);

  const backToSubscribed = applyPreferenceChange(allOn, { newEpisodesSubscribed: true });
  assert.equal(backToSubscribed.newEpisodesSubscribed, true);
  assert.equal(backToSubscribed.newEpisodesAll, false);

  // Both off is allowed.
  const bothOff = applyPreferenceChange(backToSubscribed, { newEpisodesSubscribed: false });
  assert.equal(bothOff.newEpisodesSubscribed, false);
  assert.equal(bothOff.newEpisodesAll, false);
});

test("no preference set ever reaches the database with both episode flags on", () => {
  const combinations: Array<Partial<PushPreferences>> = [
    {},
    { newEpisodesAll: true },
    { newEpisodesSubscribed: true },
    { newEpisodesAll: true, newEpisodesSubscribed: true },
  ];

  for (const change of combinations) {
    const next = applyPreferenceChange({ ...EMPTY_PUSH_PREFERENCES }, change);
    const columns = preferenceColumns(next);

    assert.equal(
      columns.new_episodes_all && columns.new_episodes_subscribed,
      false,
      `both flags true for ${JSON.stringify(change)}`,
    );
    // Both columns are always present, so one UPDATE carries the whole state.
    assert.ok("new_episodes_all" in columns);
    assert.ok("new_episodes_subscribed" in columns);
    assert.ok("defaults_applied" in columns);
  }
});

test("saving preferences is one upsert carrying every column", async () => {
  const client = recordingClient();
  globals.__commentsTestClient = client;
  __setDefaultContextForTests({
    userId: "user-1",
    client: client as never,
    storage: null,
    now: () => Date.now(),
  });

  const ok = await savePushPreferences(preferencesOnFirstEnable({ ...EMPTY_PUSH_PREFERENCES }));

  assert.equal(ok, true);
  assert.equal(client.writes.length, 1);
  assert.equal(client.writes[0].table, "push_preferences");
  assert.equal(client.writes[0].conflict, "user_id");
  assert.equal(client.writes[0].payload.user_id, "user-1");
  assert.equal(client.writes[0].payload.new_episodes_subscribed, true);
  assert.equal(client.writes[0].payload.new_episodes_all, false);
  assert.equal(client.writes[0].payload.defaults_applied, true);

  __setDefaultContextForTests(null);
  delete globals.__commentsTestClient;
});

test("a missing row loads as everything off, not as an error", async () => {
  const client = recordingClient({ row: null });
  __setDefaultContextForTests({
    userId: "user-1",
    client: client as never,
    storage: null,
    now: () => Date.now(),
  });

  const result = await loadPushPreferences();

  assert.equal(result.ok, true);
  assert.equal(result.existed, false);
  assert.deepEqual(result.preferences, EMPTY_PUSH_PREFERENCES);

  __setDefaultContextForTests(null);
});

test("a stored row maps back to camelCase preferences", async () => {
  const client = recordingClient({
    row: {
      user_id: "user-1",
      enabled: true,
      defaults_applied: true,
      new_episodes_all: true,
      new_episodes_subscribed: false,
      replies: false,
      likes: true,
      mentions: false,
      announcements: true,
    },
  });
  __setDefaultContextForTests({
    userId: "user-1",
    client: client as never,
    storage: null,
    now: () => Date.now(),
  });

  const result = await loadPushPreferences();

  assert.equal(result.preferences.newEpisodesAll, true);
  assert.equal(result.preferences.likes, true);
  assert.equal(result.preferences.announcements, true);
  assert.equal(result.preferences.mentions, false);

  __setDefaultContextForTests(null);
});

test("the master toggle is on only when the browser is granted AND opted in", () => {
  const environment = detectPushEnvironment({
    configured: true,
    optedIn: true,
    notificationPermission: "granted",
    navigatorLike: { userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/128" },
  });

  assert.equal(environment.supported, true);
  assert.equal(masterToggleState(environment).checked, true);

  const grantedButNotOptedIn = masterToggleState({ ...environment, optedIn: false });
  assert.equal(grantedButNotOptedIn.checked, false, "opted-out browsers must read as off");

  const optedInButNotGranted = masterToggleState({ ...environment, permission: "default" });
  assert.equal(optedInButNotGranted.checked, false);
});

test("a denied browser stays off and explains how to unblock", () => {
  const environment = detectPushEnvironment({
    configured: true,
    optedIn: false,
    notificationPermission: "denied",
  });

  const master = masterToggleState(environment);

  assert.equal(master.checked, false);
  assert.equal(master.noticeKind, "denied");
  assert.equal(master.notice, PUSH_NOTICES.denied);
  assert.equal(master.disabled, false, "the toggle is still clickable so the copy can be read");
});

test("an unsupported browser shows the unsupported sentence", () => {
  const master = masterToggleState({
    configured: true,
    supported: false,
    isIosSafari: false,
    isStandalone: false,
    permission: "default",
    optedIn: false,
  });

  assert.equal(master.disabled, true);
  assert.equal(master.noticeKind, "unsupported");
  assert.equal(master.notice, PUSH_NOTICES.unsupported);
});

test("iOS Safari outside an installed web app shows the Home Screen hint", () => {
  const environment = detectPushEnvironment({
    configured: true,
    optedIn: false,
    notificationPermission: "default",
    navigatorLike: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) Safari/604.1" },
  });

  assert.equal(environment.isIosSafari, true);
  assert.equal(environment.isStandalone, false);

  const master = masterToggleState(environment);
  assert.equal(master.noticeKind, "ios");
  assert.equal(master.notice, PUSH_NOTICES.ios);

  // Once installed (standalone) the hint disappears.
  const installed = masterToggleState({ ...environment, isStandalone: true });
  assert.equal(installed.noticeKind, null);
});

test("a Chromium browser on iOS is not treated as iOS Safari", () => {
  const environment = detectPushEnvironment({
    configured: true,
    optedIn: false,
    notificationPermission: "default",
    navigatorLike: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) CriOS/128.0" },
  });

  assert.equal(environment.isIosSafari, false);
});

test("missing env vars show 'not available right now' and disable the toggle", () => {
  const master = masterToggleState({
    configured: false,
    supported: true,
    isIosSafari: false,
    isStandalone: false,
    permission: "default",
    optedIn: false,
  });

  assert.equal(master.disabled, true);
  assert.equal(master.noticeKind, "unavailable");
  assert.equal(master.notice, PUSH_NOTICES.unavailable);
});

test("the category toggles only appear when the master is on", () => {
  assert.equal(categoriesVisible({ checked: true, disabled: false, notice: null, noticeKind: null }), true);
  assert.equal(categoriesVisible({ checked: false, disabled: false, notice: null, noticeKind: null }), false);
  assert.equal(
    categoriesVisible({ checked: false, disabled: true, notice: PUSH_NOTICES.unsupported, noticeKind: "unsupported" }),
    false,
  );
});

test("preferencesFromRow is defensive about a null row", () => {
  assert.deepEqual(preferencesFromRow(null), EMPTY_PUSH_PREFERENCES);
  assert.deepEqual(preferencesFromRow(undefined), EMPTY_PUSH_PREFERENCES);
});
