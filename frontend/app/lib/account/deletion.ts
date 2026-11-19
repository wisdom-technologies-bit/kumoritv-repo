// Phase 6, part F: what an account deletion actually removes.
//
// The route used to be a list of deletes inline, which meant nothing could test
// the list. The order and the list are the point, so they live here with the
// side effects injected, and the route is wiring.
//
// WHAT GOES AND WHAT STAYS
//   comments          anonymise_user_comments: a comment with replies stays with
//                     user_id NULL and the body "[deleted]"; one without replies
//                     is removed. Not a plain delete: other people replied to it.
//   personal rows     favourites, watchlist, watch_progress, comment_reactions.
//   community rows    posts (their comments cascade), reactions, blocks in both
//                     directions, staff_roles.
//   clips             the user's own clips. `clips.user_id` is ON DELETE SET
//                     NULL, so leaving them would keep the author_username and
//                     avatar snapshots - personal data - on a public row.
//   reports           the person's OWN reports are removed by the anonymiser
//                     (Prompt 38D: a deleted account leaves no report behind).
//                     Everyone else's reports, including ones about their
//                     content, are KEPT: reporter_id and resolved_by are ON
//                     DELETE SET NULL, so the trail survives without the person.
//   moderation log    KEPT for the same reason: actor_id SET NULL, the action
//                     and its reason stay.
//   bell + outbox     user_notifications and push_outbox are ON DELETE CASCADE
//                     on auth.users, so the final deleteUser removes them. The
//                     push identity is removed separately, before that, because
//                     OneSignal is outside the database.
//
// OneSignal holds the browser subscription under external_id = the user's id. If
// it is not removed, a deleted account keeps receiving pushes. That call is best
// effort: a push provider that is down must never leave an account undeletable.

export type StepResult = { error: { message?: string } | null };

export type DeletionDeps = {
  userId: string;
  /** anonymise_user_comments(p_user) */
  anonymiseComments: () => Promise<StepResult>;
  /** delete from <table> where <column> = userId */
  deleteWhere: (table: string, column: string) => Promise<StepResult>;
  /** Remove the OneSignal identity. Never throws; resolves either way. */
  removePushIdentity: () => Promise<{ ok: boolean; status?: number }>;
  /** auth.admin.deleteUser */
  deleteAuthUser: () => Promise<StepResult>;
};

/** Rows that belong to the person and nothing else. */
export const PERSONAL_TABLES: ReadonlyArray<{ table: string; column: string }> = [
  { table: "favourites", column: "user_id" },
  { table: "watchlist", column: "user_id" },
  { table: "watch_progress", column: "user_id" },
  { table: "comment_reactions", column: "user_id" },
];

/** Phase 1-6 community rows. A missing table must never block a deletion. */
export const COMMUNITY_TABLES: ReadonlyArray<{ table: string; column: string }> = [
  { table: "community_posts", column: "author_id" },
  { table: "community_reactions", column: "user_id" },
  { table: "community_blocks", column: "blocker_id" },
  { table: "community_blocks", column: "blocked_id" },
  { table: "staff_roles", column: "user_id" },
];

/** The user's own public content (see the header for why clips are removed). */
export const CONTENT_TABLES: ReadonlyArray<{ table: string; column: string }> = [
  { table: "clips", column: "user_id" },
];

export type DeletionReport = {
  ok: boolean;
  /** The step that failed, when one did. Never shown to the user verbatim. */
  failedStep: string | null;
  /** Tables whose delete reported an error, for the log. */
  failedTables: string[];
  pushRemoved: boolean;
};

export async function deleteAccount(deps: DeletionDeps): Promise<DeletionReport> {
  const failedTables: string[] = [];

  // 1. Comments first: the anonymiser needs the rows to still exist.
  //    An error here is not fatal - the FK's SET NULL still strips the identity,
  //    and a stuck deletion is worse than a kept body.
  try {
    await deps.anonymiseComments();
  } catch {
    /* see above */
  }

  // 2. The person's own rows, then their community rows, then their content.
  //    Each delete is independent: one failing table must not stop the rest, or
  //    an account could never be deleted because of a single missing migration.
  for (const { table, column } of [...PERSONAL_TABLES, ...COMMUNITY_TABLES, ...CONTENT_TABLES]) {
    try {
      const result = await deps.deleteWhere(table, column);
      if (result?.error) failedTables.push(table);
    } catch {
      failedTables.push(table);
    }
  }

  // 3. The push identity, while the id still means something. Best effort.
  let pushRemoved = false;
  try {
    const push = await deps.removePushIdentity();
    pushRemoved = push.ok;
  } catch {
    pushRemoved = false;
  }

  // 4. The auth user last: it cascades the bell and the push outbox, and it is
  //    the point of no return.
  const auth = await deps.deleteAuthUser();
  if (auth?.error) {
    return { ok: false, failedStep: "auth", failedTables, pushRemoved };
  }

  return { ok: true, failedStep: null, failedTables, pushRemoved };
}
