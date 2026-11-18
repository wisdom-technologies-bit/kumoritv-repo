// Phase 6, part D: the reads the anti-spam rules need.
//
// Three indexed reads, all with the service role (a post author's own rows are
// readable by them, but other people's recent posts are not, and the cross-user
// check must see them without exposing them):
//   1. profiles.created_at  -> how old the account is;
//   2. this author's posts in the last hour -> the new-account rate and the
//      duplicate body;
//   3. the same exact body from someone else in the window -> flag only.
/* eslint-disable @typescript-eslint/no-explicit-any -- untyped Supabase builder */
import { normaliseBody, readAntispamConfig, shouldFlagCrossUserDuplicate } from "./antispam";

export type SpamFacts = {
  accountAgeHours: number | null;
  postsLastHour: number;
  duplicate: boolean;
};

export async function readSpamFacts(
  admin: any,
  userId: string,
  body: string,
  now: number = Date.now(),
): Promise<SpamFacts> {
  const config = readAntispamConfig();
  const hourAgo = new Date(now - 60 * 60_000).toISOString();
  const windowAgo = new Date(now - config.duplicateWindowMin * 60_000).toISOString();
  const normalised = normaliseBody(body);

  let accountAgeHours: number | null = null;
  let postsLastHour = 0;
  let duplicate = false;

  try {
    const { data: profile } = await admin
      .from("profiles")
      .select("created_at")
      .eq("id", userId)
      .maybeSingle();
    if (profile?.created_at) {
      accountAgeHours = (now - new Date(profile.created_at).getTime()) / 3_600_000;
    }
  } catch {
    accountAgeHours = null; // unknown age counts as new
  }

  try {
    const { data: recent } = await admin
      .from("community_posts")
      .select("body, created_at")
      .eq("author_id", userId)
      .gte("created_at", hourAgo)
      .order("created_at", { ascending: false })
      .limit(50);
    const rows = (recent ?? []) as { body: string; created_at: string }[];
    postsLastHour = rows.length;
    duplicate =
      normalised.length > 0 &&
      rows.some((row) => new Date(row.created_at).getTime() >= new Date(windowAgo).getTime() && normaliseBody(row.body) === normalised);
  } catch {
    // A failed read must not block a post: the SQL guard still holds the
    // durable limits and the duplicate check.
  }

  if (normalised.length >= 8) {
    try {
      const { data: others } = await admin
        .from("community_posts")
        .select("id")
        .neq("author_id", userId)
        .eq("body", body.trim())
        .gte("created_at", windowAgo)
        .limit(1);
      if (Array.isArray(others) && others.length > 0) {
        // Log only. Repeated identical posts across accounts are worth seeing in
        // the moderation dashboard; they are not, on their own, a reason to block.
        shouldFlagCrossUserDuplicate({ sameBodyByOthers: others.length });
        console.warn("[community] cross-user duplicate post body", { author: userId, count: others.length });
      }
    } catch {
      /* the flag is advisory */
    }
  }

  return { accountAgeHours, postsLastHour, duplicate };
}
