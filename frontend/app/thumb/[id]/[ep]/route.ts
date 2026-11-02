// Episode thumbnail served from OUR origin, so `VideoObject.thumbnailUrl` is
// never a third-party host whose robots.txt blocks Googlebot.
//
// This route must stay out of /api/ (robots.txt disallows that path) and must
// never be listed in a sitemap. Source order and safety rules live in
// app/lib/seo/thumb.ts; a bad id/ep pair is a 404, everything else gets an image.
import { thumbnailResponse } from "@/app/lib/seo/thumb";

export const runtime = "nodejs";
/** Bytes are cached by the response headers, not by the Next route cache. */
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET(
  _request: Request,
  context: { params: { id: string; ep: string } },
) {
  return thumbnailResponse({
    id: context.params?.id ?? "",
    ep: context.params?.ep ?? "",
  });
}
