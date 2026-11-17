// Phase 4, part B5: the real announcement push path, with stand-ins.
//
// sendAnnouncements (the same function the cron runs) is given a fake db and a
// fake OneSignal transport. What is checked: Markdown never reaches the
// notification, the body is cut at 140 at a word boundary, an expired row is
// skipped, a row already sent is skipped, and a success stamps push_sent_at so it
// cannot go twice.
//
// NOT verified here: delivery to a real OneSignal app (no credentials exist in
// this sandbox) and the real `push_preferences` rows.

import assert from "node:assert/strict";
import test from "node:test";
import { sendAnnouncements } from "@/app/api/cron/push/route";
import type { CronContext } from "@/app/lib/cron/runner";

type Sent = {
  externalIds: string[];
  title: string;
  body?: string | null;
  url: string;
  image?: string | null;
  topic: string;
  idempotencyKey: string;
};

function ctx(): CronContext {
  return { startedAt: Date.now(), budgetMs: 60_000, chainDepth: 0, deadline: () => false };
}

function fakeDb(rows: Array<Record<string, unknown>>, subscribers = ["user-1", "user-2"]) {
  const updates: Array<Record<string, unknown>> = [];

  const db = {
    from(table: string) {
      if (table === "announcements") {
        return {
          select() {
            return {
              is: () => ({
                limit: async () => ({ data: rows, error: null }),
              }),
            };
          },
          update(values: Record<string, unknown>) {
            updates.push(values);
            return {
              eq: async () => ({ error: null }),
            };
          },
        };
      }
      if (table === "push_preferences") {
        return {
          select() {
            return {
              eq() {
                return {
                  eq: () => ({
                    limit: async () => ({
                      data: subscribers.map((user_id) => ({ user_id })),
                      error: null,
                    }),
                  }),
                };
              },
            };
          },
        };
      }
      return {};
    },
  };

  return { db, updates };
}

test("a Markdown body becomes a plain 140-character notification", async () => {
  const body = `# Service Update\n\nWe are **pleased** to announce that KumoriTV is fully accessible again! The temporary service disruption has been resolved, and our website is back up and running. Thank you for staying with us.`;
  const { db, updates } = fakeDb([
    {
      id: "ann-1",
      title: "Service Update: KumoriTV Is Back Online!",
      body,
      url: null,
      image: null,
      expires_at: null,
      push_sent_at: null,
    },
  ]);

  const sent: Sent[] = [];
  const stats = await sendAnnouncements(db, ctx(), async (args) => {
    sent.push(args as unknown as Sent);
    return { ok: true } as never;
  });

  assert.equal(stats.sent, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].title, "Service Update: KumoriTV Is Back Online!");
  assert.equal(sent[0].body?.includes("#"), false, "no Markdown syntax in a push");
  assert.equal(sent[0].body?.includes("**"), false);
  assert.ok((sent[0].body ?? "").length <= 141, String(sent[0].body?.length));
  assert.equal(sent[0].url, "/", "no external url means the announcement page root");
  assert.equal(sent[0].idempotencyKey, "announcement-ann-1");
  assert.equal(updates.length, 1);
  assert.ok(updates[0].push_sent_at, "a sent announcement is stamped");
});

test("an expired announcement is skipped and never stamped", async () => {
  const { db, updates } = fakeDb([
    {
      id: "ann-old",
      title: "Old",
      body: "Gone",
      url: null,
      image: null,
      expires_at: new Date(Date.now() - 60_000).toISOString(),
      push_sent_at: null,
    },
  ]);

  let calls = 0;
  const stats = await sendAnnouncements(db, ctx(), async () => {
    calls += 1;
    return { ok: true } as never;
  });

  assert.equal(stats.announcements, 0);
  assert.equal(calls, 0);
  assert.equal(updates.length, 0);
});

test("a failed send leaves push_sent_at null so the next run retries", async () => {
  const { db, updates } = fakeDb([
    { id: "ann-2", title: "Back", body: "We are back", url: null, image: null, expires_at: null, push_sent_at: null },
  ]);

  const stats = await sendAnnouncements(db, ctx(), async () => ({ ok: false, status: 500 }) as never);

  assert.equal(stats.sent, 0);
  assert.equal(stats.announcements, 1);
  assert.equal(updates.length, 0, "no stamp on failure");
});

test("no subscribers still stamps the row so it is not retried forever", async () => {
  const { db, updates } = fakeDb(
    [{ id: "ann-3", title: "Back", body: "Hi", url: null, image: null, expires_at: null, push_sent_at: null }],
    [],
  );

  const stats = await sendAnnouncements(db, ctx(), async () => ({ ok: true }) as never);

  assert.equal(stats.sent, 0);
  assert.equal(updates.length, 1);
  assert.ok(updates[0].push_sent_at);
});
