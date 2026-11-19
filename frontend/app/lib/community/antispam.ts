// Phase 6, part D: anti-spam rules that run in the server validators.
//
// The DURABLE limits are in SQL (comments_guard, community_posts_guard, the
// reaction and report guards). These rules need facts the database trigger
// cannot see cheaply or at all - the account's age, how many links a body
// contains, and whether the same text was posted by OTHER people - so they run
// here, before the insert, with the service role doing one indexed read each.
//
// Every threshold is an env var with a safe default. Names are the ones the plan
// lists, because a name someone has to remember is a name that gets mis-set:
//   COMMUNITY_NEW_ACCOUNT_HOURS          default 24
//   COMMUNITY_NEW_ACCOUNT_POSTS_PER_HOUR default 3
//   COMMUNITY_MAX_LINKS                  default 2
//   COMMUNITY_NEW_ACCOUNT_MAX_LINKS      default 1
//   COMMUNITY_DUPLICATE_WINDOW_MIN       default 10
import { recordRuleHit } from "./rate-limit";

export type AntispamConfig = {
  newAccountHours: number;
  newAccountPostsPerHour: number;
  maxLinks: number;
  newAccountMaxLinks: number;
  duplicateWindowMin: number;
};

function intFrom(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min) return fallback;
  return Math.min(Math.floor(value), max);
}

/** Read per call, so a changed env var applies without a rebuild of the caller. */
export function readAntispamConfig(env: Record<string, string | undefined> = process.env): AntispamConfig {
  return {
    newAccountHours: intFrom(env.COMMUNITY_NEW_ACCOUNT_HOURS, 24, 0, 24 * 30),
    newAccountPostsPerHour: intFrom(env.COMMUNITY_NEW_ACCOUNT_POSTS_PER_HOUR, 3, 0, 100),
    maxLinks: intFrom(env.COMMUNITY_MAX_LINKS, 2, 0, 20),
    newAccountMaxLinks: intFrom(env.COMMUNITY_NEW_ACCOUNT_MAX_LINKS, 1, 0, 20),
    duplicateWindowMin: intFrom(env.COMMUNITY_DUPLICATE_WINDOW_MIN, 10, 1, 24 * 60),
  };
}

const URL_PATTERN = /(https?:\/\/|www\.)\S+/gi;

/** Links in the body, plus an attached link card counts as one. */
export function countLinks(body: string, hasLinkCard = false): number {
  const matches = body.match(URL_PATTERN) ?? [];
  return matches.length + (hasLinkCard ? 1 : 0);
}

/** The same normalisation community_posts_guard uses, so the two agree. */
export function normaliseBody(body: string): string {
  return body.toLowerCase().trim().replace(/\s+/g, " ");
}

export type SpamVerdict = { code: string; message: string; status: number } | null;

export const SPAM_MESSAGES = {
  new_account_rate: (perHour: number) =>
    `New accounts can post ${perHour} times an hour. Try again a little later.`,
  too_many_links: (max: number) => `That post has too many links. Keep it to ${max}.`,
  duplicate: "You just posted that. Give it a minute.",
} as const;

/**
 * Decide, before the insert, whether a post is spam.
 *
 * `accountAgeHours` is null when the account's age is unknown (a missing
 * profile row); an unknown age is treated as NEW, which is the safe direction.
 */
export function checkPostSpam(input: {
  body: string;
  hasLinkCard: boolean;
  accountAgeHours: number | null;
  postsLastHour: number;
  duplicate: boolean;
  config?: AntispamConfig;
}): SpamVerdict {
  const config = input.config ?? readAntispamConfig();
  const isNew = input.accountAgeHours === null || input.accountAgeHours < config.newAccountHours;
  const links = countLinks(input.body, input.hasLinkCard);

  if (input.duplicate) {
    recordRuleHit("duplicate_body");
    return { code: "duplicate_post", message: SPAM_MESSAGES.duplicate, status: 409 };
  }

  const linkCap = isNew ? Math.min(config.newAccountMaxLinks, config.maxLinks) : config.maxLinks;
  if (links > linkCap) {
    recordRuleHit(isNew ? "new_account_links" : "too_many_links");
    return {
      code: "too_many_links",
      message: SPAM_MESSAGES.too_many_links(linkCap),
      status: 400,
    };
  }

  if (isNew && config.newAccountPostsPerHour > 0 && input.postsLastHour >= config.newAccountPostsPerHour) {
    recordRuleHit("new_account_rate");
    return {
      code: "rate_limited",
      message: SPAM_MESSAGES.new_account_rate(config.newAccountPostsPerHour),
      status: 429,
    };
  }

  return null;
}

/**
 * Cross-user duplication: the same normalised body from a DIFFERENT author
 * inside the window. Logged, never blocked - a shared quote or a common phrase
 * is not spam on its own, and blocking it would punish coordination.
 */
export function shouldFlagCrossUserDuplicate(input: { sameBodyByOthers: number }): boolean {
  if (input.sameBodyByOthers <= 0) return false;
  recordRuleHit("cross_user_duplicate");
  return true;
}
