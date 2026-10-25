import { NextResponse } from "next/server";
import crypto from "node:crypto";

export function requireCron(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "cron_not_configured" }, { status: 500 });
  const value = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  const a = Buffer.from(value), b = Buffer.from(secret);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return null;
}
