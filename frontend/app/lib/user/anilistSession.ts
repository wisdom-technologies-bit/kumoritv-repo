// Server side of the AniList -> Supabase bridge, with its dependencies injected so
// the whole flow can be exercised without a live Supabase project.
//
// The flow no longer touches Firebase/Firestore: the Supabase admin client is the
// only store, and the viewer comes from one GraphQL call (`fetchAnilistViewer`).

import { anilistErrorMessage, type AnilistErrorCode } from "@/app/lib/anilist/errors";
import type { AnilistViewer, ViewerResult } from "@/app/lib/anilist/viewer";
import { normaliseTitleLanguage, type TitleLanguage } from "@/app/lib/titles/language";

export type { AnilistViewer };

export type SyncResult = {
  status: number;
  body: {
    ok: boolean;
    code?: AnilistErrorCode;
    error?: string;
    linked?: boolean;
    viewer?: AnilistViewer;
    /** Set only when this login seeded the title language (first link). */
    seededTitleLanguage?: TitleLanguage;
  };
};

type SupabaseError = { message?: string; code?: string } | null;

type SelectChain = {
  eq: (column: string, value: string) => { maybeSingle: () => PromiseLike<{ data?: unknown; error?: SupabaseError }> };
};
type UpdateChain = {
  eq: (column: string, value: string) => PromiseLike<{ error?: SupabaseError }>;
};

/** Minimal shape of the pieces used from the admin/server Supabase clients. */
export type AnilistSessionAdmin = {
  from: (table: string) => {
    select: (columns: string) => SelectChain;
    update: (values: Record<string, unknown>) => UpdateChain;
  };
  auth: {
    admin: {
      createUser: (payload: Record<string, unknown>) => Promise<{ data?: { user?: { id: string } | null } | null; error?: SupabaseError }>;
      generateLink: (payload: Record<string, unknown>) => Promise<{ data?: { properties?: { hashed_token?: string } } | null; error?: SupabaseError }>;
      updateUserById: (id: string, payload: Record<string, unknown>) => Promise<{ error?: SupabaseError }>;
    };
  };
};

export type AnilistSessionServer = {
  auth: {
    getUser: () => Promise<{ data?: { user?: { id: string; is_anonymous?: boolean; user_metadata?: Record<string, unknown> } | null } }>;
    verifyOtp: (payload: { token_hash: string; type: "magiclink" }) => Promise<{ error?: SupabaseError }>;
  };
};

export type AnilistSessionDeps = {
  createAdmin: () => AnilistSessionAdmin | null;
  createServerClient: () => Promise<AnilistSessionServer | null>;
  fetchViewer: (accessToken: string) => Promise<ViewerResult>;
  randomPassword?: () => string;
};

export function decodeAnilistTokenPayload(
  token: string
): { aud?: string | string[]; sub?: string | number } | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;

    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/** Supabase reports an existing email with several shapes; none of them is fatal. */
export function isAlreadyRegistered(error: SupabaseError) {
  const message = (error?.message ?? "").toLowerCase();

  return (
    error?.code === "email_exists" ||
    error?.code === "user_already_exists" ||
    message.includes("already been registered") ||
    message.includes("already registered") ||
    message.includes("already exists")
  );
}

export function usernameCandidate(name: string, id: number) {
  const clean = name.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 40);

  return (clean.length >= 3 ? clean : `user${id}`).slice(0, 40);
}

function fail(code: AnilistErrorCode, status = 400): SyncResult {
  return { status, body: { ok: false, code, error: anilistErrorMessage(code) } };
}

export function anilistEmailFor(id: number) {
  return `anilist-${id}@anilist.invalid`;
}

async function uniqueUsername(admin: AnilistSessionAdmin, base: string) {
  let candidate = base;

  for (let suffix = 1; suffix < 10000; suffix += 1) {
    const { data } = await admin.from("public_profiles").select("id").eq("username", candidate).maybeSingle();

    if (!data) return candidate;

    const suffixText = String(suffix);
    candidate = `${base.slice(0, 40 - suffixText.length)}${suffixText}`;
  }

  return `${base.slice(0, 35)}${Date.now()}`.slice(0, 40);
}

export function defaultRandomPassword() {
  return Buffer.from(`${Date.now()}-${Math.random()}`).toString("base64url").slice(0, 43);
}

/**
 * Seeds `profiles.title_language` from the viewer's AniList option, but only when
 * the user has never chosen one in KumoriTV (`title_language_source = 'default'`).
 *
 * A profile created before the `title_language_source` column existed cannot be
 * told apart from one where the user picked English, so the seed is skipped when
 * the column is missing. Never overwriting a choice beats seeding.
 */
async function seedTitleLanguage(
  admin: AnilistSessionAdmin,
  userId: string,
  viewer: AnilistViewer
): Promise<TitleLanguage | undefined> {
  const wanted = normaliseTitleLanguage(viewer.options?.titleLanguage);

  if (!wanted) return undefined;

  const { data, error } = await admin
    .from("profiles")
    .select("title_language, title_language_source")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) return undefined;

  const row = data as { title_language?: string | null; title_language_source?: string | null };

  if (row.title_language_source !== "default") return undefined;

  const { error: updateError } = await admin
    .from("profiles")
    .update({ title_language: wanted, title_language_source: "anilist" })
    .eq("id", userId);

  return updateError ? undefined : wanted;
}

/**
 * Validates the AniList token, then:
 *  - links the AniList identity onto an existing (non anonymous) Supabase session,
 *  - otherwise creates/reuses `anilist-<id>@anilist.invalid` and signs in as it
 *    (which replaces an anonymous session).
 *
 * Never lists users: `admin.listUsers()` only returns the first page, which broke
 * sign-in for returning users once the project passed 1000 users.
 */
export async function syncAnilistSession({
  accessToken,
  clientId,
  deps,
}: {
  accessToken?: string | null;
  clientId?: string | null;
  deps: AnilistSessionDeps;
}): Promise<SyncResult> {
  if (!accessToken) return fail("ANILIST_TOKEN_MISSING");
  if (!clientId) return fail("ANILIST_CONFIG_MISSING", 503);

  const payload = decodeAnilistTokenPayload(accessToken);

  if (!payload) return fail("ANILIST_VIEWER_401");

  const audValid = Array.isArray(payload.aud)
    ? payload.aud.includes(clientId)
    : payload.aud === clientId;
  const id = Number(payload.sub);

  if (!audValid || !Number.isFinite(id)) return fail("ANILIST_VIEWER_401");

  const viewerResult = await deps.fetchViewer(accessToken);

  if (!viewerResult.ok) return fail(viewerResult.code, viewerResult.status);

  const viewer = viewerResult.viewer;

  if (viewer.id !== id) return fail("ANILIST_VIEWER_401", 401);

  const admin = deps.createAdmin();
  const serverClient = await deps.createServerClient();

  if (!admin || !serverClient) return fail("ANILIST_SYNC_FAILED", 503);

  const { data: sessionData } = await serverClient.auth.getUser();
  const currentUser = sessionData?.user ?? null;

  if (currentUser && !currentUser.is_anonymous) {
    const { error } = await admin.auth.admin.updateUserById(currentUser.id, {
      user_metadata: {
        ...(currentUser.user_metadata ?? {}),
        anilist_id: id,
        anilist_name: viewer.name ?? null,
        anilist_avatar: viewer.avatar?.large || viewer.avatar?.medium || null,
      },
    });

    if (error) return fail("ANILIST_SYNC_FAILED", 503);

    const seededTitleLanguage = await seedTitleLanguage(admin, currentUser.id, viewer);

    return { status: 200, body: { ok: true, linked: true, viewer, seededTitleLanguage } };
  }

  const email = anilistEmailFor(id);
  const created = await admin.auth.admin.createUser({
    email,
    password: (deps.randomPassword ?? defaultRandomPassword)(),
    email_confirm: true,
    app_metadata: { provider: "anilist", anilist_id: id },
    user_metadata: {
      username: await uniqueUsername(admin, usernameCandidate(String(viewer.name || "Anonymous"), id)),
      full_name: viewer.name,
      avatar_url: viewer.avatar?.large || viewer.avatar?.medium || null,
    },
  });

  if (created.error && !isAlreadyRegistered(created.error)) return fail("ANILIST_SYNC_FAILED", 503);

  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = link.data?.properties?.hashed_token;

  if (link.error || !tokenHash) return fail("ANILIST_SYNC_FAILED", 500);

  const verified = await serverClient.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });

  if (verified.error) return fail("ANILIST_SYNC_FAILED", 500);

  const { data: signedIn } = await serverClient.auth.getUser();
  const userId = signedIn?.user?.id ?? created.data?.user?.id;

  const seededTitleLanguage = userId
    ? await seedTitleLanguage(admin, userId, viewer)
    : undefined;

  return { status: 200, body: { ok: true, linked: false, viewer, seededTitleLanguage } };
}
