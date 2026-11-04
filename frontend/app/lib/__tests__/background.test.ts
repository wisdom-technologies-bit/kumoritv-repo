// Prompt 24: one background helper, whatever the host.
//
// The detached path (Render, Railway, a bare `next start`) is the one under test:
// `VERCEL` is unset so the Vercel hand-off never runs, and NEXT_MANUAL_SIG_HANDLE
// keeps the shutdown warning quiet. Every test drains what it starts, because the
// tracked set is module-level.

import assert from "node:assert/strict";
import test from "node:test";
import {
  drainBackground,
  pendingBackgroundCount,
  runInBackground,
} from "@/app/lib/background";

process.env.NEXT_MANUAL_SIG_HANDLE = "true";
delete process.env.VERCEL;
delete process.env.BACKGROUND_DRAIN_TIMEOUT_MS;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Swaps console.error for a collector; the returned function restores it. */
function captureErrors(): { messages: string[]; restore: () => void } {
  const messages: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    messages.push(args.map((arg) => String(arg)).join(" "));
  };
  return { messages, restore: () => { console.error = original; } };
}

test("returns immediately, tracks the task, and drain waits for it", async () => {
  let finished = false;
  const startedAt = Date.now();
  runInBackground(
    async () => {
      await delay(60);
      finished = true;
    },
    { label: "slow task" },
  );
  const returnedAfter = Date.now() - startedAt;

  assert.ok(returnedAfter < 40, `runInBackground blocked for ${returnedAfter}ms`);
  assert.equal(pendingBackgroundCount(), 1);
  assert.equal(finished, false);

  assert.equal(await drainBackground(2_000), true);
  assert.equal(finished, true);
  assert.equal(pendingBackgroundCount(), 0);
});

test("drain returns immediately when nothing is pending", async () => {
  assert.equal(pendingBackgroundCount(), 0);
  assert.equal(await drainBackground(50), true);
});

test("accepts a promise, a thenable and a function", async () => {
  const seen: string[] = [];

  runInBackground(
    delay(5).then(() => {
      seen.push("promise");
    }),
  );

  const thenable = {
    then(onFulfilled: () => void) {
      setTimeout(() => {
        seen.push("thenable");
        onFulfilled();
      }, 5);
    },
  };
  runInBackground(thenable as unknown as PromiseLike<void>);

  runInBackground(async () => {
    await delay(5);
    seen.push("function");
  });

  assert.equal(pendingBackgroundCount(), 3);
  assert.equal(await drainBackground(2_000), true);
  assert.deepEqual(seen.sort(), ["function", "promise", "thenable"]);
  assert.equal(pendingBackgroundCount(), 0);
});

test("rejections and sync throws are caught, logged, and do not leak", async () => {
  const captured = captureErrors();
  const leaks: unknown[] = [];
  const onLeak = (reason: unknown) => leaks.push(reason);
  process.on("unhandledRejection", onLeak);
  try {
    runInBackground(Promise.reject(new Error("rejected task")), { label: "reject" });
    runInBackground(
      () => {
        throw new Error("sync throw");
      },
      { label: "sync throw" },
    );
    runInBackground(async () => {
      throw new Error("async throw");
    });

    assert.equal(await drainBackground(2_000), true);
    await delay(50);
  } finally {
    process.off("unhandledRejection", onLeak);
    captured.restore();
  }

  assert.equal(leaks.length, 0, `leaked rejections: ${leaks.map(String).join(", ")}`);
  assert.equal(pendingBackgroundCount(), 0);
  assert.ok(
    captured.messages.some((line) => line.startsWith("[background] reject failed:")),
    captured.messages.join(" | "),
  );
  assert.ok(
    captured.messages.some((line) => line.startsWith("[background] sync throw failed:")),
    captured.messages.join(" | "),
  );
  assert.ok(
    captured.messages.some((line) => line.startsWith("[background] task failed:")),
    captured.messages.join(" | "),
  );
});

test("drain gives up on a hung task, then succeeds once it is released", async () => {
  const gate: { release?: () => void } = {};
  runInBackground(
    () =>
      new Promise<void>((resolve) => {
        gate.release = resolve;
      }),
    { label: "hung task" },
  );

  const startedAt = Date.now();
  assert.equal(await drainBackground(80), false);
  const waited = Date.now() - startedAt;
  assert.ok(waited >= 70 && waited < 1_000, `drain waited ${waited}ms`);
  assert.equal(pendingBackgroundCount(), 1);

  gate.release?.();
  assert.equal(await drainBackground(2_000), true);
  assert.equal(pendingBackgroundCount(), 0);
});

test("drain waits for tasks started by other tasks", async () => {
  const order: string[] = [];
  runInBackground(
    async () => {
      await delay(10);
      runInBackground(
        async () => {
          await delay(20);
          order.push("child");
        },
        { label: "child task" },
      );
      order.push("parent");
    },
    { label: "parent task" },
  );

  assert.equal(await drainBackground(2_000), true);
  assert.deepEqual(order, ["parent", "child"]);
  assert.equal(pendingBackgroundCount(), 0);
});
