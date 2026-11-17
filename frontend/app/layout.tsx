import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Header from "./layout/header";
import Footer from "./layout/footer";
import NextTopLoader from "nextjs-toploader";
import { Analytics } from "@vercel/analytics/next";
import StoreProvider from "./lib/redux/StoreProvider";
import LoadingPageContainer from "./components/LoadingContainer";
import GoogleAnalytics from "./googleAnalytics";
import { AuthProvider } from "./lib/supabase/AuthProvider";
import PushProvider from "./lib/push/PushProvider";
import AdcashTag from "./components/Ads/AdcashTag";
import { readAdcashConfig } from "./lib/ads/adcash";
import CommunityLatestProvider from "./components/CommunityToast";
import { isCommunityEnabled } from "./lib/community/flag";
import { readLatestConfig } from "./lib/community/latest";

const inter = Inter({ subsets: ["latin"] });

export const viewport: Viewport = {
  themeColor: "#0B0B14",
};

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://kumoritv.top";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  alternates: { types: { "application/rss+xml": "/feed.xml" } },
  title: {
    default: "KumoriTV",
    template: "%s | KumoriTV",
  },
  description: "Watch anime on KumoriTV.",
  manifest: "/manifest.webmanifest",
  // Explicit set so every browser lands on something it can render: SVG for
  // modern browsers, ICO for older Safari/IE-era tab strips and anything that
  // asks for /favicon.ico directly, PNG for Android home screens.
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "16x16 32x32 48x48" },
      { url: "/android-chrome-192.png", sizes: "192x192", type: "image/png" },
      { url: "/android-chrome-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    title: "KumoriTV",
    description: "Watch anime on KumoriTV.",
    images: ["/og-image.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "KumoriTV",
    description: "Watch anime on KumoriTV.",
    images: ["/og-image.png"],
  },
  other: { "theme-color": "#0B0B14" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Adcash (Prompt 39B): read per render, never hard-coded, off unless
  // ADCASH_ENABLED=1. Bracket access keeps the value a runtime lookup instead of
  // a build-time inline, so a Railway variable change needs no code change.
  const adcash = readAdcashConfig((name) => process.env[name]);

  // Community Phase 4: the flag and the toast tuning are read per render, not
  // inlined at build time. With the flag off the provider renders its children
  // and nothing else: no timer, no poll, no markup.
  const communityEnabled = isCommunityEnabled();
  const latestConfig = readLatestConfig((name) => process.env[name]);

  return (
    <html lang="en">
      <head>
        {/* The site's only ad tag: Adcash Autotag, see docs/ads-adcash.md */}
        <AdcashTag
          enabled={adcash.enabled}
          zoneId={adcash.zoneId}
          excludePaths={adcash.excludePaths}
        />
      </head>
      <GoogleAnalytics /> {/* Google Analytics */}
      <body className={inter.className}>
        <Analytics /> {/* Vercel Analytics - Has use limit */}
        <StoreProvider>
          <AuthProvider>
            {/* Phase 4: ONE poll and ONE toast host for the whole site. Inside
                AuthProvider so the toast knows the viewer; the flag is a prop,
                so nothing of this phase mounts when it is off. */}
            <CommunityLatestProvider enabled={communityEnabled} config={latestConfig}>
              {/* Only signed-in users ever load OneSignal; the bell does not need it. */}
              <PushProvider />
              <Header />

              <NextTopLoader color="var(--brand-color)" showSpinner={false} />

              {children || <LoadingPageContainer />}

              <Footer />
            </CommunityLatestProvider>
          </AuthProvider>
        </StoreProvider>
      </body>
    </html>
  );
}
