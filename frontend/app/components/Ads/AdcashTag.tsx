"use client";

/**
 * Adcash Autotag - the two official steps, in order, once per full page load.
 *
 * Step 1 is the <Script> element: `id="aclib"`, the absolute https URL (never
 * the snippet's protocol-relative `//acscdn.com/...`), loaded after hydration.
 * Step 2 is `aclib.runAutoTag({ zoneId })`, called from `onReady`/`onLoad` and
 * guarded so it runs exactly once (see runAdcashAutoTag).
 *
 * Why `afterInteractive` and not `beforeInteractive`: in the App Router
 * `beforeInteractive` is only honoured for scripts placed directly in
 * app/layout.tsx, it cannot be rendered conditionally per request, it has no
 * `onLoad`/`onReady` callback (so step 2 would have no reliable trigger) and it
 * blocks hydration for an ad. `afterInteractive` is what actually satisfies
 * "step 1 then step 2, once".
 *
 * Renders nothing at all when disabled or on an excluded path, so a disabled
 * site ships no ad markup.
 */

import { useEffect, useState } from "react";
import Script from "next/script";
import { usePathname } from "next/navigation";
import {
  ADCASH_SCRIPT_ID,
  ADCASH_SCRIPT_SRC,
  isAdcashExcludedPath,
  runAdcashAutoTag,
} from "@/app/lib/ads/adcash";

export type AdcashTagProps = {
  enabled: boolean;
  zoneId: string;
  /** Path prefixes that must never load the tag (from ADCASH_EXCLUDE_PATHS). */
  excludePaths: string[];
};

export default function AdcashTag({ enabled, zoneId, excludePaths }: AdcashTagProps) {
  const pathname = usePathname();
  /**
   * Prompt 41 (D): `?ads=off` skips the Autotag for THIS page view only, so the
   * owner can tap once and compare the page with and without it (that is how the
   * floating blue "download" circle is proved to be third-party or ours). It is
   * never stored, never a cookie, and does nothing while ADCASH_ENABLED is off.
   */
  const [adsOff, setAdsOff] = useState(false);
  useEffect(() => {
    try {
      setAdsOff(new URLSearchParams(window.location.search).get("ads") === "off");
    } catch {
      setAdsOff(false);
    }
  }, [pathname]);

  if (!enabled || !zoneId || adsOff) return null;
  if (isAdcashExcludedPath(pathname, excludePaths)) return null;

  const run = () => {
    runAdcashAutoTag(zoneId);
  };

  return (
    <Script
      id={ADCASH_SCRIPT_ID}
      src={ADCASH_SCRIPT_SRC}
      type="text/javascript"
      strategy="afterInteractive"
      onReady={run}
      onLoad={run}
      onError={() => {
        /* a blocked or missing ad library must never break the page */
      }}
    />
  );
}
