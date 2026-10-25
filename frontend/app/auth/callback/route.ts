import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/app/lib/supabase/server";
import { sanitizeNextPath } from "@/app/lib/supabase/auth";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = sanitizeNextPath(request.nextUrl.searchParams.get("next"));
  const client = createClient();
  if (!client || !code) return NextResponse.redirect(new URL("/?auth_error=callback", request.url));
  const { error } = await client.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/?auth_error=callback", request.url));
  return NextResponse.redirect(new URL(next, request.url));
}
