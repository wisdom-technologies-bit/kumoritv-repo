// Episode-level social card. Lives outside /api/ because robots.txt blocks it.
import { ogImageResponse } from "@/app/lib/seo/og-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: { id: string; ep: string } },
) {
  return ogImageResponse({ id: context.params?.id ?? "", episode: context.params?.ep ?? null });
}
