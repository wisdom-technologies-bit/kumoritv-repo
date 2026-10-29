import React from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { LEGAL_BRAND } from "@/app/lib/legal/content";
import { regionFromHeaders } from "@/app/lib/legal/geo";
import { TermsOfServiceContent } from "./content";

const TITLE = `Terms of Service | ${LEGAL_BRAND}`;

// The wording depends on the visitor's country, so it is rendered per request.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: `The rules for using ${LEGAL_BRAND}: accounts, acceptable use, third-party streams, intellectual property, disclaimers and liability.`,
  alternates: { canonical: "/terms" },
  // Region-sensitive text; deliberately kept out of search results.
  robots: { index: false, follow: false, nocache: true },
  openGraph: {
    title: TITLE,
    description: `The agreement between you and ${LEGAL_BRAND}.`,
    url: "/terms",
    type: "article",
  },
};

export default function TermsOfServicePage() {
  return <TermsOfServiceContent region={regionFromHeaders(headers())} />;
}
