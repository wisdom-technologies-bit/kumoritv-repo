import "server-only";

// Phase 6, part A: who is staff, decided on the server, every time.
//
// The role lives in public.staff_roles, which no browser role can read (no
// policy at all and no table privilege). `is_staff()` and `is_admin()` are
// security-definer functions over it. This module asks those two functions with
// the CALLER's session cookie, so:
//   * a route cannot claim a role it does not have;
//   * the reads and writes that follow run as that same user, so RLS applies as
//     a second, independent gate.
//
// No service role is used anywhere in this file, or by any admin route or page.
// The ONLY place Phase 6 uses the service role is the comment write API
// (/api/comments), where RLS cannot express "insert only through the API"
// without dropping the browser insert policy first - see the lockdown SQL.
import { isCommunityEnabled } from "./flag";
import { createAuthServerClient } from "@/app/lib/supabase/auth-server";

export type StaffRole = "moderator" | "admin";
export type StaffMember = { userId: string; role: StaffRole };

export type StaffClient = {
  auth: {
    getUser: () => Promise<{ data: { user: { id: string; is_anonymous?: boolean } | null } }>;
  };
  rpc: (name: "is_staff" | "is_admin") => Promise<{ data: unknown; error: unknown }>;
};

/** The signed-in staff member, or null. Never throws. */
export async function readCommunityStaff(client?: StaffClient | null): Promise<StaffMember | null> {
  try {
    const active = client ?? ((await createAuthServerClient()) as unknown as StaffClient | null);
    if (!active) return null;

    const { data } = await active.auth.getUser();
    const user = data?.user;
    // A "continue as guest" Supabase session is a real auth.users row, but it is
    // not an account and can never be staff.
    if (!user || user.is_anonymous) return null;

    const { data: isStaff } = await active.rpc("is_staff");
    if (isStaff !== true) return null;

    const { data: isAdmin } = await active.rpc("is_admin");
    return { userId: user.id, role: isAdmin === true ? "admin" : "moderator" };
  } catch {
    return null;
  }
}

export type StaffGate =
  | { ok: true; client: StaffClient; staff: StaffMember }
  | { ok: false; response: Response };

function json(body: unknown, status: number, extra?: Record<string, string>): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...(extra ?? {}) } });
}

/**
 * The gate every /api/community/admin route shares.
 *
 *   404  the community is off, or the caller is signed in but not staff
 *        (404 rather than 403: a normal reader should not learn the route exists)
 *   401  nobody is signed in
 *   503  Supabase is not configured
 */
export async function requireStaffSession(): Promise<StaffGate> {
  if (!isCommunityEnabled()) return { ok: false, response: json({ error: "not_found" }, 404) };

  const client = (await createAuthServerClient()) as unknown as StaffClient | null;
  if (!client) return { ok: false, response: json({ error: "unavailable" }, 503) };

  const { data } = await client.auth.getUser();
  const user = data?.user;
  if (!user || user.is_anonymous) {
    return {
      ok: false,
      response: json({ error: "unauthorized", message: "Sign in with a staff account." }, 401),
    };
  }

  const staff = await readCommunityStaff(client);
  if (!staff) return { ok: false, response: json({ error: "not_found" }, 404) };

  return { ok: true, client, staff };
}

/** The page-side equivalent: staff, or null (the page then 404s). */
export async function readStaffForPage(): Promise<StaffMember | null> {
  if (!isCommunityEnabled()) return null;
  return readCommunityStaff();
}

/** Announcements stay admin-only, as in Phase 4. */
export async function readAdminForPage(): Promise<StaffMember | null> {
  const staff = await readStaffForPage();
  return staff?.role === "admin" ? staff : null;
}
