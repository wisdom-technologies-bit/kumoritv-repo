// Prompt 21, part 6: the Notifications section of the settings modal.
// A fake push client stands in for OneSignal so the master toggle's four states
// (granted / denied / unsupported / iOS) and the account toggles can be driven.

import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { click, flush, render, type RenderedTree } from "../../test-harness/render";
import NotificationsSection, {
  NOTIFICATIONS_SECTION_ID,
} from "@/app/layout/header/components/User/UserSettingsModal/NotificationsSection";
import { PUSH_NOTICES } from "@/app/lib/push/state";
import { __setPushClientForTests, __resetPushRuntimeForTests } from "@/app/lib/push/runtime";
import { __setDefaultContextForTests } from "@/app/lib/user-data/context";
import { __setUserSearchClientForTests } from "@/app/lib/users/search";

const APP_ID = "11111111-2222-3333-4444-555555555555";

type Write = { table: string; payload: Record<string, unknown>; conflict?: string };

/** Supabase double: one stored push_preferences row, and a log of every write. */
function fakeClient(options: {
  row?: Record<string, unknown> | null;
  failWrites?: boolean;
} = {}) {
  const writes: Write[] = [];

  function builderFor(table: string): any {
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

        return Promise.resolve({
          error: options.failWrites ? { message: "write failed" } : null,
        });
      },
      then(resolve: (value: unknown) => unknown) {
        return Promise.resolve({ data: null, error: null }).then(resolve);
      },
    };

    return self;
  }

  return { writes, from: (table: string) => builderFor(table) };
}

/** Minimal OneSignal Web SDK v16 double. */
function oneSignalDouble(options: {
  permission?: NotificationPermission;
  permissionResult?: boolean;
  optedIn?: boolean;
} = {}) {
  const calls: string[] = [];
  const client = {
    Notifications: {
      permissionNative: options.permission ?? "default",
      requestPermission: async () => {
        calls.push("requestPermission");
        return options.permissionResult ?? true;
      },
    },
    User: {
      PushSubscription: {
        optedIn: options.optedIn ?? false,
        optIn: async () => {
          calls.push("optIn");
        },
        optOut: async () => {
          calls.push("optOut");
        },
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    },
    login: async (id: string) => {
      calls.push(`login:${id}`);
    },
    logout: async () => {
      calls.push("logout");
    },
  };

  return { client, calls };
}

function setSignedIn(row: Record<string, unknown> | null, failWrites = false) {
  const client = fakeClient({ row, failWrites });
  __setDefaultContextForTests({
    userId: "user-1",
    client: client as never,
    storage: window.localStorage as never,
    now: () => Date.now(),
  });

  return client;
}

async function renderSection(isSignedIn = true): Promise<RenderedTree> {
  const tree = await render(React.createElement(NotificationsSection, { isSignedIn }));
  await flush();
  await flush();

  return tree;
}

function switchById(tree: RenderedTree, id: string): HTMLInputElement | null {
  return tree.container.querySelector(`#${id}`) as HTMLInputElement | null;
}

const CATEGORY_IDS = [
  "settings-push-all-episodes",
  "settings-push-subscribed-episodes",
  "settings-push-replies",
  "settings-push-likes",
  "settings-push-mentions",
  "settings-push-announcements",
];

/** Toggles a checkbox the way a browser does (checked flips, change fires). */
async function toggle(element: HTMLInputElement) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "checked",
  )?.set;

  await click(element).catch(async () => {
    setter?.call(element, !element.checked);
    element.dispatchEvent(new window.Event("change", { bubbles: true }));
    await flush();
  });
}

async function flip(element: HTMLInputElement | null) {
  assert.ok(element, "the switch exists");
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "checked",
  )?.set;

  await React.act?.(async () => {
    setter?.call(element, !element!.checked);
    element!.dispatchEvent(new window.Event("click", { bubbles: true }));
    element!.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
  await flush();
  await flush();
}

const reactAct = React as unknown as {
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

const act = async (callback: () => Promise<void> | void) => {
  await reactAct.act(callback);
};

test.beforeEach(() => {
  const scope = globalThis as unknown as Record<string, unknown>;
  scope.PushManager = class {};
  Object.defineProperty(navigator, "serviceWorker", { value: {}, configurable: true });
  process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID = APP_ID;
});

test.afterEach(() => {
  delete process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
  __setDefaultContextForTests(null);
  __resetPushRuntimeForTests();
  __setUserSearchClientForTests(null);
});

test("the section carries the six account toggles and the master switch", async () => {
  setSignedIn({
    user_id: "user-1",
    enabled: true,
    defaults_applied: true,
    new_episodes_all: false,
    new_episodes_subscribed: true,
    replies: true,
    likes: false,
    mentions: false,
    announcements: true,
  });
  const { client } = oneSignalDouble({ permission: "granted", optedIn: true });
  __setPushClientForTests(client as never);

  const tree = await renderSection();

  try {
    const section = tree.container.querySelector(`#${NOTIFICATIONS_SECTION_ID}`);
    assert.ok(section, "the section is present");

    const text = section!.textContent ?? "";
    assert.match(text, /Push notifications/);
    assert.match(text, /New episodes \(all anime\)/);
    assert.match(text, /New episodes from anime I subscribed to/);
    assert.match(text, /Replies to my comments/);
    assert.match(text, /Likes on my comments/);
    assert.match(text, /Mentions/);
    assert.match(text, /Announcements from KumoriTV/);

    for (const id of CATEGORY_IDS) {
      assert.ok(switchById(tree, id), `${id} is rendered`);
    }
  } finally {
    await tree.unmount();
  }
});

test("the master reads this browser: granted and opted in is on", async () => {
  setSignedIn({ user_id: "user-1", enabled: true, defaults_applied: true });
  const { client } = oneSignalDouble({ permission: "granted", optedIn: true });
  __setPushClientForTests(client as never);

  const tree = await renderSection();

  try {
    assert.equal(switchById(tree, "settings-push-master")?.checked, true);
    assert.ok(tree.container.querySelector("[data-push-categories='true']"));
  } finally {
    await tree.unmount();
  }
});

test("opted out in this browser reads as off even when the account flag is on", async () => {
  setSignedIn({ user_id: "user-1", enabled: true, defaults_applied: true });
  const { client } = oneSignalDouble({ permission: "granted", optedIn: false });
  __setPushClientForTests(client as never);

  const tree = await renderSection();

  try {
    assert.equal(switchById(tree, "settings-push-master")?.checked, false);
    assert.equal(tree.container.querySelector("[data-push-categories='true']"), null);
  } finally {
    await tree.unmount();
  }
});

test("without an app id the section says push is unavailable and hides the rest", async () => {
  delete process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
  setSignedIn(null);

  const tree = await renderSection();

  try {
    const notice = tree.container.querySelector("[data-push-notice='unavailable']");
    assert.equal(notice?.textContent, PUSH_NOTICES.unavailable);
    assert.equal(switchById(tree, "settings-push-master")?.disabled, true);
    assert.equal(tree.container.querySelector("[data-push-categories='true']"), null);
  } finally {
    await tree.unmount();
  }
});

test("a browser without push support is explained", async () => {
  delete (globalThis as Record<string, unknown>).PushManager;
  setSignedIn(null);

  const tree = await renderSection();

  try {
    const notice = tree.container.querySelector("[data-push-notice='unsupported']");
    assert.equal(notice?.textContent, PUSH_NOTICES.unsupported);
  } finally {
    await tree.unmount();
  }
});

test("iOS Safari outside a home-screen app gets the install hint", async () => {
  const originalUserAgent = navigator.userAgent;
  Object.defineProperty(navigator, "userAgent", {
    value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) Version/18.1 Safari/604.1",
    configurable: true,
  });
  setSignedIn(null);

  const tree = await renderSection();

  try {
    const notice = tree.container.querySelector("[data-push-notice='ios']");
    assert.equal(notice?.textContent, PUSH_NOTICES.ios);
  } finally {
    Object.defineProperty(navigator, "userAgent", { value: originalUserAgent, configurable: true });
    await tree.unmount();
  }
});

test("a denied browser is not asked again and gets the unblock copy", async () => {
  const client = setSignedIn({ user_id: "user-1", enabled: false, defaults_applied: true });
  const double = oneSignalDouble({ permission: "denied", permissionResult: false, optedIn: false });
  __setPushClientForTests(double.client as never);

  const tree = await renderSection();

  try {
    await act(async () => {
      tree.container
        .querySelector("#settings-push-master")
        ?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    await flush();
    await flush();

    assert.equal(double.calls.includes("requestPermission"), false);
    assert.equal(double.calls.includes("optIn"), false);
    assert.equal(
      tree.container.querySelector("[data-push-notice='denied']")?.textContent,
      PUSH_NOTICES.denied,
    );
    assert.equal(client.writes.length, 0, "nothing is saved when permission is blocked");
  } finally {
    await tree.unmount();
  }
});

test("the first enable applies the defaults once, in a single write", async () => {
  const client = setSignedIn({ user_id: "user-1", enabled: false, defaults_applied: false });
  const double = oneSignalDouble({ permission: "default", permissionResult: true, optedIn: false });
  __setPushClientForTests(double.client as never);

  const tree = await renderSection();

  try {
    await act(async () => {
      tree.container
        .querySelector("#settings-push-master")
        ?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    await flush();
    await flush();

    assert.ok(double.calls.includes("requestPermission"), "the browser is asked");
    assert.ok(double.calls.includes("optIn"));

    assert.equal(client.writes.length, 1, "one write carries the whole state");
    const payload = client.writes[0].payload;
    assert.equal(payload.enabled, true);
    assert.equal(payload.defaults_applied, true);
    assert.equal(payload.new_episodes_subscribed, true, "subscribed anime is on");
    assert.equal(payload.announcements, true, "announcements are on");
    assert.equal(payload.new_episodes_all, false, "all anime is off");
    assert.equal(payload.replies, false);
    assert.equal(payload.likes, false);
    assert.equal(payload.mentions, false);
  } finally {
    await tree.unmount();
  }
});

test("a returning user keeps their own choices instead of the defaults", async () => {
  const client = setSignedIn({
    user_id: "user-1",
    enabled: false,
    defaults_applied: true,
    new_episodes_all: false,
    new_episodes_subscribed: false,
    replies: true,
    likes: true,
    mentions: true,
    announcements: false,
  });
  const double = oneSignalDouble({ permission: "default", permissionResult: true });
  __setPushClientForTests(double.client as never);

  const tree = await renderSection();

  try {
    await act(async () => {
      tree.container
        .querySelector("#settings-push-master")
        ?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    await flush();
    await flush();

    assert.equal(client.writes.length, 1);
    const payload = client.writes[0].payload;
    assert.equal(payload.enabled, true);
    assert.equal(payload.replies, true, "their choices survive");
    assert.equal(payload.likes, true);
    assert.equal(payload.mentions, true);
    assert.equal(payload.announcements, false, "they turned announcements off");
    assert.equal(payload.new_episodes_subscribed, false);
  } finally {
    await tree.unmount();
  }
});

test("turning a category on writes both episode flags in one update", async () => {
  const client = setSignedIn({
    user_id: "user-1",
    enabled: true,
    defaults_applied: true,
    new_episodes_all: false,
    new_episodes_subscribed: true,
    replies: false,
    likes: false,
    mentions: false,
    announcements: true,
  });
  const double = oneSignalDouble({ permission: "granted", optedIn: true });
  __setPushClientForTests(double.client as never);

  const tree = await renderSection();

  try {
    await act(async () => {
      const replies = tree.container.querySelector("#settings-push-replies") as HTMLInputElement;
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "checked")?.set?.call(
        replies,
        true,
      );
      replies.dispatchEvent(new window.Event("click", { bubbles: true }));
    });
    await flush();
    await flush();

    assert.equal(client.writes.length, 1);
    const payload = client.writes[0].payload;
    assert.equal(payload.replies, true);
    assert.equal(payload.new_episodes_all, false);
    assert.equal(payload.new_episodes_subscribed, true);
  } finally {
    await tree.unmount();
  }
});

test("turning on 'all anime' turns 'subscribed' off in the same write", async () => {
  const client = setSignedIn({
    user_id: "user-1",
    enabled: true,
    defaults_applied: true,
    new_episodes_all: false,
    new_episodes_subscribed: true,
    announcements: true,
  });
  const double = oneSignalDouble({ permission: "granted", optedIn: true });
  __setPushClientForTests(double.client as never);

  const tree = await renderSection();

  try {
    await act(async () => {
      const all = tree.container.querySelector("#settings-push-all-episodes") as HTMLInputElement;
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "checked")?.set?.call(
        all,
        true,
      );
      all.dispatchEvent(new window.Event("click", { bubbles: true }));
    });
    await flush();
    await flush();

    const payload = client.writes[0].payload;
    assert.equal(payload.new_episodes_all, true);
    assert.equal(payload.new_episodes_subscribed, false, "never both, so the CHECK holds");
  } finally {
    await tree.unmount();
  }
});

test("a failed save rolls the category switch back", async () => {
  setSignedIn(
    {
      user_id: "user-1",
      enabled: true,
      defaults_applied: true,
      new_episodes_subscribed: true,
      replies: false,
      announcements: true,
    },
    true,
  );
  const double = oneSignalDouble({ permission: "granted", optedIn: true });
  __setPushClientForTests(double.client as never);

  const tree = await renderSection();

  try {
    await act(async () => {
      const replies = tree.container.querySelector("#settings-push-replies") as HTMLInputElement;
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "checked")?.set?.call(
        replies,
        true,
      );
      replies.dispatchEvent(new window.Event("click", { bubbles: true }));
    });
    await flush();
    await flush();

    assert.equal(switchById(tree, "settings-push-replies")?.checked, false, "rolled back");
    assert.match(tree.container.textContent ?? "", /could not be saved/i);
  } finally {
    await tree.unmount();
  }
});

test("a signed-out visitor is told to sign in", async () => {
  setSignedIn(null);
  const tree = await renderSection(false);

  try {
    assert.match(tree.container.textContent ?? "", /Sign in to choose/i);
    assert.equal(switchById(tree, "settings-push-master"), null);
  } finally {
    await tree.unmount();
  }
});
