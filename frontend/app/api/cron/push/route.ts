// Push cron: /api/cron/push
//
// Steps, in order:
//   1. claim up to 200 unsent outbox rows (RPC `claim_push_outbox`, safe against
//      overlapping runs), re-check the preference at send time, send, mark sent
//      or count the attempt.
//   2. (nothing) subscribed-anime episodes are enqueued BY THE DATABASE trigger
//      `episodes_notify_playable_trg` the moment an episode becomes playable, so
//      there is no app-side enqueue here. Its bell rows come from the same
//      trigger family.
//   3. digest for users with "new episodes (all anime)" on: at most one per three
//      hours, only when something new aired, one bell row + one outbox row.
//   4. announcements with `push_sent_at is null` and not expired: push, then
//      stamp `push_sent_at` so it is sent exactly once.
//
// Adult-flagged anime are never pushed to a user whose `show_adult` is off.

import { createAdminClient } from "@/app/lib/supabase/admin";
import {
  DIGEST_EPISODE_LIMIT,
  DIGEST_USER_LIMIT,
  OUTBOX_BATCH,
} from "@/app/lib/push/cron";
import { runCronJob, type CronContext } from "@/app/lib/cron/runner";
import { sendPush } from "@/app/lib/push/onesignal";
import {
  DIGEST_TITLE_LIMIT,
  digestAllowed,
  digestBody,
  digestDedupeKey,
  digestTitle,
  episodeAnilistIdFromUrl,
  isAdultPushAllowed,
  preferenceAllows,
  PUSH_TOPICS,
  type OutboxKind,
  type PreferenceFlags,
} from "@/app/lib/push/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;


type OutboxRow = {
  id: number;
  user_id: string;
  type: OutboxKind;
  title: string;
  body: string | null;
  url: string | null;
  image: string | null;
  dedupe_key: string;
  attempts: number;
};

type PreferenceRow = PreferenceFlags & { user_id: string; digest_last_sent_at: string | null };

function hashKey(parts: string[]): string {
  // Stable, dependency-free bucket for the idempotency key.
  let hash = 0;
  const value = parts.join("|");

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }

  return Math.abs(hash).toString(36);
}

async function loadPreferences(db: any, userIds: string[]): Promise<Map<string, PreferenceRow>> {
  const map = new Map<string, PreferenceRow>();
  const unique = [...new Set(userIds)];
  if (!unique.length) return map;

  const { data } = await db
    .from("push_preferences")
    .select(
      "user_id, enabled, new_episodes_all, new_episodes_subscribed, replies, likes, mentions, announcements, digest_last_sent_at",
    )
    .in("user_id", unique);

  for (const row of (data ?? []) as PreferenceRow[]) map.set(row.user_id, row);

  return map;
}

async function loadAdultVisibility(db: any, userIds: string[]): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>();
  const unique = [...new Set(userIds)];
  if (!unique.length) return map;

  const { data } = await db.from("profiles").select("id, show_adult").in("id", unique);
  for (const row of (data ?? []) as Array<{ id: string; show_adult: boolean | null }>) {
    map.set(row.id, row.show_adult === true);
  }

  return map;
}

/** anilist_id -> is_adult for the anime a batch of episode pushes points at. */
async function loadAdultAnime(db: any, anilistIds: number[]): Promise<Map<number, boolean>> {
  const map = new Map<number, boolean>();
  const unique = [...new Set(anilistIds.filter((id) => Number.isFinite(id)))];
  if (!unique.length) return map;

  const { data } = await db.from("anime").select("anilist_id, is_adult").in("anilist_id", unique);
  for (const row of (data ?? []) as Array<{ anilist_id: number; is_adult: boolean | null }>) {
    map.set(Number(row.anilist_id), row.is_adult === true);
  }

  return map;
}

type SendOutcome = { sent: number; skipped: number; failed: number; retryable: number };

/**
 * Step 1 + step 3: send whatever the outbox holds. Rows are grouped by identical
 * payload so one OneSignal request covers many users, and a single idempotency
 * key covers a retry of the same batch.
 */
async function flushRows(
  db: any,
  rows: OutboxRow[],
  prefs: Map<string, PreferenceRow>,
  showAdult: Map<string, boolean>,
  adultAnime: Map<number, boolean>,
): Promise<SendOutcome> {
  const outcome: SendOutcome = { sent: 0, skipped: 0, failed: 0, retryable: 0 };
  if (!rows.length) return outcome;

  const sendable: OutboxRow[] = [];
  const skipped: OutboxRow[] = [];

  for (const row of rows) {
    if (!preferenceAllows(row.type, prefs.get(row.user_id))) {
      skipped.push(row);
      continue;
    }

    // Episode pushes: re-check the adult flag at send time, because
    // `show_adult` may have changed since the row was written.
    if (row.type === "episode") {
      const anilistId = episodeAnilistIdFromUrl(row.url);
      if (anilistId !== null) {
        const isAdult = adultAnime.get(anilistId) === true;
        if (!isAdultPushAllowed({ isAdult, showAdult: showAdult.get(row.user_id) })) {
          skipped.push(row);
          continue;
        }
      }
    }

    sendable.push(row);
  }

  if (skipped.length) {
    await db
      .from("push_outbox")
      .update({ sent_at: new Date().toISOString(), last_error: "skipped: preference off" })
      .in("id", skipped.map((row) => row.id));
    outcome.skipped = skipped.length;
  }

  // Group by payload, then chunk inside `sendPush` (2000 ids per request).
  const groups = new Map<string, OutboxRow[]>();
  for (const row of sendable) {
    const signature = [row.type, row.title, row.body ?? "", row.url ?? "", row.image ?? ""].join("\u0000");
    const bucket = groups.get(signature) ?? [];
    bucket.push(row);
    groups.set(signature, bucket);
  }

  for (const [, group] of groups.entries()) {
    const lead = group[0];
    const result = await sendPush({
      externalIds: group.map((row) => row.user_id),
      title: lead.title,
      body: lead.body,
      url: lead.url,
      image: lead.image,
      topic: PUSH_TOPICS[lead.type] ?? null,
      idempotencyKey: `outbox-${hashKey([lead.type, lead.title, ...group.map((row) => row.user_id)])}`,
    });

    const ids = group.map((row) => row.id);

    if (result.ok) {
      await db
        .from("push_outbox")
        .update({ sent_at: new Date().toISOString(), last_error: null })
        .in("id", ids);
      outcome.sent += group.length;
    } else if (result.skipped) {
      // No OneSignal key: leave the rows unsent and retryable, and say why.
      await db
        .from("push_outbox")
        .update({ last_error: result.error ?? "skipped: onesignal unavailable", attempts: 0 })
        .in("id", ids);
      outcome.failed += group.length;
    } else {
      await db
        .from("push_outbox")
        .update({ last_error: (result.error ?? "send failed").slice(0, 200) })
        .in("id", ids);
      outcome.failed += group.length;
      if (result.retryable) outcome.retryable += group.length;
    }
  }

  return outcome;
}

/** Step 3: "new episodes (all anime)" digest, one per user per three hours. */
async function sendDigests(db: any, ctx: CronContext) {
  const stats = { users: 0, sent: 0, skipped: 0 };

  const { data: candidates } = await db
    .from("push_preferences")
    .select("user_id, enabled, new_episodes_all, new_episodes_subscribed, replies, likes, mentions, announcements, digest_last_sent_at")
    .eq("enabled", true)
    .eq("new_episodes_all", true)
    .limit(DIGEST_USER_LIMIT);

  const now = Date.now();
  const users = ((candidates ?? []) as PreferenceRow[]).filter((row) =>
    digestAllowed(row.digest_last_sent_at, now),
  );

  if (!users.length) return stats;

  const oldestCursor = Math.min(
    ...users.map((row) => Date.parse(row.digest_last_sent_at ?? "") || 0),
  );
  // Never look further back than a day: a fresh account must not receive the
  // whole back catalogue in one digest.
  const since = new Date(Math.max(oldestCursor, now - 24 * 60 * 60 * 1000)).toISOString();
  const earliestAir = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Episodes that became playable since the oldest cursor, that aired recently.
  const { data: episodes } = await db
    .from("episodes")
    .select("anilist_id, episode_number, title, image_url, playable_at, air_date")
    .gt("playable_at", since)
    .gte("air_date", earliestAir)
    .order("playable_at", { ascending: false })
    .limit(DIGEST_EPISODE_LIMIT);

  const rows = (episodes ?? []) as Array<{
    anilist_id: number;
    episode_number: number;
    title: string | null;
    image_url: string | null;
    playable_at: string;
    air_date: string | null;
  }>;

  if (!rows.length) return stats;

  const animeIds = [...new Set(rows.map((row) => Number(row.anilist_id)))];
  const { data: animeRows } = await db
    .from("anime")
    .select("anilist_id, title, title_english, cover_url, is_adult")
    .in("anilist_id", animeIds);

  const anime = new Map<number, { title: string; cover: string | null; isAdult: boolean }>();
  for (const row of (animeRows ?? []) as Array<{
    anilist_id: number;
    title: string | null;
    title_english: string | null;
    cover_url: string | null;
    is_adult: boolean | null;
  }>) {
    anime.set(Number(row.anilist_id), {
      title: row.title_english || row.title || `Anime ${row.anilist_id}`,
      cover: row.cover_url ?? null,
      isAdult: row.is_adult === true,
    });
  }

  const showAdult = await loadAdultVisibility(db, users.map((row) => row.user_id));

  for (const user of users) {
    if (ctx.deadline()) break;
    stats.users += 1;

    const cursor = user.digest_last_sent_at ? Date.parse(user.digest_last_sent_at) : 0;
    const fresh = rows.filter((row) => {
      const playable = Date.parse(row.playable_at);
      if (!Number.isFinite(playable) || playable <= cursor) return false;

      const info = anime.get(Number(row.anilist_id));
      if (!info) return false;

      return isAdultPushAllowed({ isAdult: info.isAdult, showAdult: showAdult.get(user.user_id) });
    });

    if (!fresh.length) {
      stats.skipped += 1;
      continue;
    }

    const count = fresh.length;
    const titles = fresh.slice(0, DIGEST_TITLE_LIMIT).map((row) => anime.get(Number(row.anilist_id))?.title ?? "");
    const sentAt = new Date(now).toISOString();
    const lead = fresh[0];
    const leadAnime = anime.get(Number(lead.anilist_id));

    // Bell row first: it must exist even if the push cannot be delivered.
    await db.from("user_notifications").insert({
      user_id: user.user_id,
      kind: "digest",
      title: digestTitle(count),
      body: digestBody(titles, count),
      url: "/",
      image: leadAnime?.cover ?? null,
    });

    const result = await sendPush({
      externalIds: [user.user_id],
      title: digestTitle(count),
      body: digestBody(titles, count),
      url: "/",
      image: leadAnime?.cover ?? null,
      topic: PUSH_TOPICS.digest,
      idempotencyKey: digestDedupeKey(user.user_id, now),
    });

    if (result.ok) {
      // Only advance the cursor when the push actually went out, otherwise the
      // episodes would never be mentioned again.
      await db
        .from("push_preferences")
        .update({ digest_last_sent_at: sentAt })
        .eq("user_id", user.user_id);
      stats.sent += 1;
    } else {
      stats.skipped += 1;

      // The bell row was written for this window; remember it in the outbox so a
      // later run can still deliver it without a second bell row.
      await db.from("push_outbox").insert({
        user_id: user.user_id,
        type: "digest",
        title: digestTitle(count),
        body: digestBody(titles, count),
        url: "/",
        image: leadAnime?.cover ?? null,
        dedupe_key: digestDedupeKey(user.user_id, now),
      });
    }
  }

  return stats;
}

/** Step 4: announcements, exactly once each. */
async function sendAnnouncements(db: any, ctx: CronContext) {
  const stats = { announcements: 0, sent: 0, users: 0 };

  const { data: pending } = await db
    .from("announcements")
    .select("id, title, body, url, image, expires_at, push_sent_at")
    .is("push_sent_at", null)
    .limit(5);

  const now = Date.now();
  const due = ((pending ?? []) as Array<{
    id: string;
    title: string;
    body: string | null;
    url: string | null;
    image: string | null;
    expires_at: string | null;
    push_sent_at: string | null;
  }>).filter((row) => !row.push_sent_at && (!row.expires_at || Date.parse(row.expires_at) > now));

  if (!due.length) return stats;

  const { data: subscribers } = await db
    .from("push_preferences")
    .select("user_id, enabled, new_episodes_all, new_episodes_subscribed, replies, likes, mentions, announcements")
    .eq("enabled", true)
    .eq("announcements", true)
    .limit(5000);

  const userIds = ((subscribers ?? []) as PreferenceRow[]).map((row) => row.user_id);

  for (const announcement of due) {
    if (ctx.deadline()) break;
    stats.announcements += 1;

    if (!userIds.length) {
      // Nobody to tell: still stamp it so it is not retried forever.
      await db
        .from("announcements")
        .update({ push_sent_at: new Date().toISOString() })
        .eq("id", announcement.id);
      continue;
    }

    const result = await sendPush({
      externalIds: userIds,
      title: announcement.title,
      body: announcement.body,
      url: announcement.url || "/",
      image: announcement.image,
      topic: PUSH_TOPICS.announcement,
      idempotencyKey: `announcement-${announcement.id}`,
    });

    if (result.ok) {
      await db
        .from("announcements")
        .update({ push_sent_at: new Date().toISOString() })
        .eq("id", announcement.id);
      stats.sent += 1;
      stats.users += userIds.length;
    }
    // A failure leaves push_sent_at null on purpose: the next run retries it.
  }

  return stats;
}

export async function GET(request: Request) {
  return runCronJob({
    request,
    job: "push",
    inline: true,
    handler: async (ctx) => {
      // The prompt 21 tables are not in the generated Database types yet, so the
      // client is untyped in this file on purpose (same as other new-table code).
      const db = createAdminClient() as any;
      if (!db) return { error: "supabase_not_configured" };

      const stats: Record<string, unknown> = {};

      // 1. Claim and send what the database already queued.
      const { data: claimed, error: claimError } = await db.rpc("claim_push_outbox", {
        p_limit: OUTBOX_BATCH,
      });

      if (claimError) {
        stats.cannotClaimOutbox = claimError.message;
      }

      const rows = ((claimed ?? []) as unknown as OutboxRow[]).filter((row) => row && row.user_id);
      if (rows.length) {
        const prefs = await loadPreferences(db, rows.map((row) => row.user_id));
        const showAdult = await loadAdultVisibility(db, rows.map((row) => row.user_id));
        const adultAnime = await loadAdultAnime(
          db,
          rows.map((row) => episodeAnilistIdFromUrl(row.url)).filter((id): id is number => id !== null),
        );

        stats.outbox = await flushRows(db, rows, prefs, showAdult, adultAnime);
      } else {
        stats.outbox = { claimed: 0, sent: 0, skipped: 0, failed: 0, retryable: 0 };
      }

      // 2. Subscribed-anime episodes: handled by the episodes trigger in SQL.
      stats.subscribedEpisodes = "handled_by_database";

      // 3. Digests.
      if (!ctx.deadline()) stats.digest = await sendDigests(db, ctx);

      // 4. Announcements.
      if (!ctx.deadline()) stats.announcements = await sendAnnouncements(db, ctx);

      return stats;
    },
  });
}

export async function POST(request: Request) {
  return GET(request);
}
