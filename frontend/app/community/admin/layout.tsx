// /community/admin - the moderation surface never ships to a normal visitor.
//
// The gate is server-side and per request: the community flag, then a real
// session, then is_staff() through THAT session (see app/lib/community/staff).
// A signed-in non-staff user gets notFound() - they should not learn the route
// exists. The layout is also where noindex lives, so every page under it
// inherits "do not index" without repeating the metadata.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { readStaffForPage } from "@/app/lib/community/staff";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Moderation",
  robots: { index: false, follow: false, nocache: true },
};

export default async function CommunityAdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await readStaffForPage();
  if (!staff) notFound();
  return <>{children}</>;
}
