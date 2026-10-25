import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Header from "./layout/header";
import Footer from "./layout/footer";
import NextTopLoader from "nextjs-toploader";
import { Analytics } from "@vercel/analytics/react";
import Script from "next/script";
import StoreProvider from "./lib/redux/StoreProvider";
import LoadingPageContainer from "./components/LoadingContainer";
import GoogleAnalytics from "./googleAnalytics";

const inter = Inter({ subsets: ["latin"] });

export const viewport: Viewport = {
  themeColor: "#0B0B14",
};

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://kumoritv.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  alternates: { types: { "application/rss+xml": "/feed.xml" } },
  title: {
    default: "KumoriTV",
    template: "%s | KumoriTV",
  },
  description: "Watch anime on KumoriTV.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/favicon.svg",
    apple: "/apple-touch-icon.png",
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
  return (
    <html lang="en">
      <Script src="/register-sw.js" />
      <GoogleAnalytics /> {/* Google Analytics */}
      <body className={inter.className}>
        <Analytics /> {/* Vercel Analytics - Has use limit */}
        <StoreProvider>
          <Header />

          <NextTopLoader color="var(--brand-color)" showSpinner={false} />

          {children || <LoadingPageContainer />}

          <Footer />
        </StoreProvider>
      </body>
    </html>
  );
}
