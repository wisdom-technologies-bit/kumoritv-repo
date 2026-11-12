// POST /api/clips/[code]/view
//
// Light analytics: one increment per session per clip. The session is a
// first-party cookie holding only the codes this browser already counted, so no
// personal data is stored and no IP is written to the table.

import { cookies } from "next/headers";
import { CLIP_SEEN_COOKIE } from "@/app/lib/clips/constants";
import { isClipCode } from "@/app/lib/clips/code";
import { getClipByCode, incrementClipViews } from "@/app/lib/clips/server";
import { readSeenCodes, rememberSeenCode } from "@/app/lib/clips/views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: { code: string } },
) {
  const code = params?.code ?? "";
  if (!isClipCode(code)) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const row = await getClipByCode(code);
  if (!row) return Response.json({ error: "not_found" }, { status: 404 });

  const seen = readSeenCodes(cookies().get(CLIP_SEEN_COOKIE)?.value);
  if (seen.includes(code)) {
    return Response.json({ counted: false, views: Number(row.views) || 0 });
  }

  const views = await incrementClipViews(code);
  const next = rememberSeenCode(seen, code);
  // Session cookie: no maxAge, cleared when the browser closes.
  cookies().set(CLIP_SEEN_COOKIE, next.join(","), {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });

  return Response.json(
    { counted: views !== null, views: views ?? (Number(row.views) || 0) },
    { headers: { "cache-control": "no-store" } },
  );
}
