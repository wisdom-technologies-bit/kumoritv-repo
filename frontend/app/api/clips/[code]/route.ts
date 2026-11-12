// GET / PATCH / DELETE /api/clips/[code]
//
//   GET    - one live clip, plus whether THIS caller may rename/delete it.
//   PATCH  - rename (owner only).
//   DELETE - soft delete (owner only: the clip's user, or the guest cookie).
//
// The session user id is read from Supabase, never from the request body.

import { cookies } from "next/headers";
import { CLIP_OWNER_COOKIE } from "@/app/lib/clips/constants";
import { validateRenameClipBody } from "@/app/lib/clips/body";
import { isClipCode } from "@/app/lib/clips/code";
import { canManageClip, deleteClip, getClipByCode, renameClip, toPublicClip } from "@/app/lib/clips/server";
import { readClipViewer, readOwnerCookie } from "@/app/lib/clips/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const notFound = () =>
  Response.json({ error: "not_found", message: "This clip does not exist." }, { status: 404 });

const unavailable = () =>
  Response.json({ error: "database_unavailable" }, { status: 503 });

export async function GET(
  _request: Request,
  { params }: { params: { code: string } },
) {
  const code = params?.code ?? "";
  if (!isClipCode(code)) return notFound();

  const row = await getClipByCode(code);
  if (!row) return notFound();

  const viewer = await readClipViewer();
  const ownerToken = readOwnerCookie();
  return Response.json(
    {
      clip: toPublicClip(row),
      canManage: canManageClip(row, { userId: viewer.userId, ownerToken }),
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: { code: string } },
) {
  const code = params?.code ?? "";
  if (!isClipCode(code)) return notFound();

  const body = await request.json().catch(() => null);
  const parsed = validateRenameClipBody(body);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error, message: parsed.message }, { status: 400 });
  }

  const viewer = await readClipViewer();
  const result = await renameClip(code, parsed.value.title, {
    userId: viewer.userId,
    ownerToken: readOwnerCookie(),
  });

  if (result.result === "not_found") return notFound();
  if (result.result === "forbidden") {
    return Response.json(
      { error: "forbidden", message: "This clip is not yours to change." },
      { status: 403 },
    );
  }
  if (result.result !== "ok" || !result.clip) return unavailable();

  return Response.json(
    { clip: toPublicClip(result.clip) },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function DELETE(
  _request: Request,
  { params }: { params: { code: string } },
) {
  const code = params?.code ?? "";
  if (!isClipCode(code)) return notFound();

  const viewer = await readClipViewer();
  const result = await deleteClip(code, {
    userId: viewer.userId,
    ownerToken: readOwnerCookie(),
  });

  if (result === "not_found") return notFound();
  if (result === "forbidden") {
    return Response.json(
      { error: "forbidden", message: "This clip is not yours to delete." },
      { status: 403 },
    );
  }
  if (result !== "ok") return unavailable();

  // A guest's cookie has no other purpose once its clips are gone; leaving it
  // alone is harmless too, so it is only cleared when it exists and the caller
  // was a guest (a signed-in caller never had one worth keeping).
  if (!viewer.userId && cookies().get(CLIP_OWNER_COOKIE)?.value) {
    cookies().set(CLIP_OWNER_COOKIE, "", { path: "/", maxAge: 0 });
  }

  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
