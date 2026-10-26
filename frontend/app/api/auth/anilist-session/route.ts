import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/app/lib/supabase/admin";
import { createClient } from "@/app/lib/supabase/server";

const attempts = new Map<string, { count: number; expiresAt: number }>();

function decodePayload(token: string): { aud?: string | string[]; sub?: string | number } | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function usernameCandidate(name: string, id: number) {
  const clean = name.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 40);
  return (clean.length >= 3 ? clean : `user${id}`).slice(0, 40);
}

async function uniqueUsername(admin: NonNullable<ReturnType<typeof createAdminClient>>, base: string) {
  let candidate = base;
  for (let suffix = 1; suffix < 10000; suffix += 1) {
    const { data } = await admin.from("public_profiles").select("id").eq("username", candidate).maybeSingle();
    if (!data) return candidate;
    const suffixText = String(suffix);
    candidate = `${base.slice(0, 40 - suffixText.length)}${suffixText}`;
  }
  return `${base.slice(0, 35)}${Date.now()}`.slice(0, 40);
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const now = Date.now();
  const current = attempts.get(ip);
  if (!current || current.expiresAt <= now) attempts.set(ip, { count: 1, expiresAt: now + 60_000 });
  else if (current.count >= 10) return NextResponse.json({ ok: false, error: "Unable to sign in" }, { status: 429 });
  else current.count += 1;

  try {
    const { accessToken } = (await request.json()) as { accessToken?: string };
    if (!accessToken) throw new Error("invalid token");
    const payload = decodePayload(accessToken);
    const clientId = process.env.NEXT_PUBLIC_ANILIST_CLIENT_ID;
    if (!payload || !clientId) throw new Error("invalid token");
    const audValid = Array.isArray(payload.aud) ? payload.aud.includes(clientId) : payload.aud === clientId;
    const id = Number(payload.sub);
    if (!audValid || !Number.isFinite(id)) throw new Error("invalid token");

    const apiUrl = process.env.NEXT_PUBLIC_ANILIST_API_URL || "https://graphql.anilist.co";
    const viewerResponse = await fetch(apiUrl, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ query: "query { Viewer { id name avatar { large medium } } }" }) });
    const viewer = (await viewerResponse.json())?.data?.Viewer;
    if (!viewer || viewer.id !== id) throw new Error("invalid viewer");

    const admin = createAdminClient();
    const serverClient = await createClient();
    if (!admin || !serverClient) throw new Error("unavailable");
    const email = `anilist-${id}@anilist.invalid`;
    let userId: string | null = null;
    const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    userId = listed.data.users.find((user) => user.email === email)?.id ?? null;
    if (!userId) {
      const username = await uniqueUsername(admin, usernameCandidate(String(viewer.name || "Anonymous"), id));
      const created = await admin.auth.admin.createUser({ email, password: randomBytes(32).toString("base64url"), email_confirm: true, app_metadata: { provider: "anilist", anilist_id: id }, user_metadata: { username, full_name: viewer.name, avatar_url: viewer.avatar?.large || viewer.avatar?.medium || null } });
      if (created.error) throw new Error("unable to create user");
      userId = created.data.user?.id ?? null;
    }
    if (!userId) throw new Error("unable to create user");
    const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
    const tokenHash = link.data.properties?.hashed_token;
    if (!tokenHash) throw new Error("unable to create session");
    const verified = await serverClient.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
    if (verified.error) throw new Error("unable to create session");
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "Unable to sign in" }, { status: 400 });
  }
}
