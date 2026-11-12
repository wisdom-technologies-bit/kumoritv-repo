// POST /api/clips/[code]/report
//
// There is no existing report mechanism for clips in the repo (comments and
// watch errors do not collect reports), so this writes the small `clip_reports`
// table. The reporter is a salted hash, never an IP or an account. The page also
// offers a mailto link as a fallback when the API is unavailable.

import { CLIP_REPORT_RATE } from "@/app/lib/clips/constants";
import { validateClipReportBody } from "@/app/lib/clips/body";
import { isClipCode } from "@/app/lib/clips/code";
import { hashIdentifier, ownerTokenSecret } from "@/app/lib/clips/owner-token";
import { createRateLimiter } from "@/app/lib/clips/rate-limit";
import { getClipByCode, reportClip } from "@/app/lib/clips/server";
import { clientIp } from "@/app/lib/clips/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reportLimiter = createRateLimiter();

export async function POST(
  request: Request,
  { params }: { params: { code: string } },
) {
  const code = params?.code ?? "";
  if (!isClipCode(code)) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const ip = clientIp(request);
  const decision = reportLimiter.check(`report:${ip}`, CLIP_REPORT_RATE);
  if (!decision.allowed) {
    return Response.json(
      { error: "rate_limited", retryAfter: decision.retryAfterSeconds },
      { status: 429, headers: { "retry-after": String(decision.retryAfterSeconds) } },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = validateClipReportBody(body);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error, message: parsed.message }, { status: 400 });
  }

  const row = await getClipByCode(code);
  if (!row) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const saved = await reportClip({
    clipId: row.id,
    reason: parsed.value.reason,
    details: parsed.value.details,
    // Salted hash of the IP only: enough to spot abuse, no personal data.
    reporterHash: hashIdentifier(`report:${ip}`, ownerTokenSecret()),
  });

  if (!saved) return Response.json({ error: "unavailable" }, { status: 503 });
  return Response.json({ ok: true }, { status: 201, headers: { "cache-control": "no-store" } });
}
