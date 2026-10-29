import React from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { LEGAL_BRAND } from "@/app/lib/legal/content";
import { regionFromHeaders } from "@/app/lib/legal/geo";
import { PrivacyPolicyContent } from "./content";

const TITLE = `Privacy Policy | ${LEGAL_BRAND}`;

// The wording depends on the visitor's country, so it is rendered per request.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: `${LEGAL_BRAND} Privacy Policy: what we collect when you browse, search, watch or sign in, how cookies and advertising work, and the rights you have over your data.`,
  alternates: { canonical: "/privacy" },
  // The policy is region-sensitive and must not be indexed.
  robots: { index: false, follow: false, nocache: true },
  openGraph: {
    title: TITLE,
    description: `How ${LEGAL_BRAND} collects, uses and protects your information.`,
    url: "/privacy",
    type: "article",
  },
};

export default function PrivacyPolicyPage() {
  return <PrivacyPolicyContent region={regionFromHeaders(headers())} />;
}
