// Phase 4: the announcements step of the push cron, kept out of the route file.
//
// A route module may export only Next's own symbols, and this step is exported so
// its real path (the pending query, the preference filter, the plain-text body,
// the push_sent_at stamp) can be tested against a stand-in db and a stand-in
// OneSignal client. So it lives here and the route imports it.
import type { CronContext } from "@/app/lib/cron/runner";
import { sendPush } from "@/app/lib/push/onesignal";
import { announcementPlainText } from "@/app/lib/community/announcement-form";
import { PUSH_TOPICS } from "@/app/lib/push/rules";

/** The two columns of push_preferences this step reads. */
type SubscriberRow = { user_id: string };

/**
 * Step 4: announcements, exactly once each.
 *
 * Exported, and the transport is a parameter, so the real code path (the pending
 * query, the preference filter, the plain-text body, the push_sent_at stamp) can
 * be tested against a stand-in db and a stand-in OneSignal client.
 */
export async function sendAnnouncements(
  // Untyped on purpose: the Phase 4 tables are not in the generated Database
  // types yet, exactly like the rest of this cron's db access.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  ctx: CronContext,
  send: typeof sendPush = sendPush,
) {
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

  const userIds = ((subscribers ?? []) as SubscriberRow[]).map((row) => row.user_id);

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

    const result = await send({
      externalIds: userIds,
      title: announcement.title,
      // Phase 4: the body is Markdown; the push carries the plain projection,
      // cut at a word boundary so a notification never ends mid-word.
      body: announcementPlainText(announcement.body, 140),
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
