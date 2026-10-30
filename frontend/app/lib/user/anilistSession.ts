// Server side of the AniList -> Supabase bridge, with its dependencies injected so
// the whole flow can be exercised without a live Supabase project.

export type AnilistViewer = {
  id: number;
  name?: string | null;
  avatar?: { large?: string | null; medium?: string | null } | null;
};

export type SessionErrorCode =
  | "invalid_request"
  | "invalid_token"
  | "viewer_mismatch"
  | "unavailable"
  | "session_failed";

export const SESSION_ERROR_MESSAGES: Record<SessionErrorCode, string> = {
  invalid_request: "The AniList login response was incomplete.",
  invalid_token: "AniList did not return a valid token.",
  viewer_mismatch: "Could not confirm your AniList account.",
  unavailable: "Account sync is temporarily unavailable.",
  session_failed: "Could not create your session.",
};

export type SyncResult = {
  status: number;
  body: { ok: boolean; code?: SessionErrorCode; error?: string; linked?: boolean };
};

type SupabaseError = { message?: string; code?: string } | null;

/** Minimal shape of the pieces used from the admin/server Supabase clients. */
export type AnilistSessionAdmin = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => PromiseLike<{ data?: unknown }>;
      };
    };
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
  fetchViewer: (accessToken: string) => Promise<AnilistViewer | null>;
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

function fail(code: SessionErrorCode, status = 400): SyncResult {
  return { status, body: { ok: false, code, error: SESSION_ERROR_MESSAGES[code] } };
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
  if (!accessToken) return fail("invalid_request");
  if (!clientId) return fail("invalid_token");

  const payload = decodeAnilistTokenPayload(accessToken);

  if (!payload) return fail("invalid_token");

  const audValid = Array.isArray(payload.aud)
    ? payload.aud.includes(clientId)
    : payload.aud === clientId;
  const id = Number(payload.sub);

  if (!audValid || !Number.isFinite(id)) return fail("invalid_token");

  const viewer = await deps.fetchViewer(accessToken).catch(() => null);

  if (!viewer || viewer.id !== id) return fail("viewer_mismatch", 401);

  const admin = deps.createAdmin();
  const serverClient = await deps.createServerClient();

  if (!admin || !serverClient) return fail("unavailable", 503);

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

    if (error) return fail("unavailable", 503);

    return { status: 200, body: { ok: true, linked: true } };
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

  if (created.error && !isAlreadyRegistered(created.error)) return fail("unavailable", 503);

  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = link.data?.properties?.hashed_token;

  if (link.error || !tokenHash) return fail("session_failed", 500);

  const verified = await serverClient.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });

  if (verified.error) return fail("session_failed", 500);

  return { status: 200, body: { ok: true, linked: false } };
}
