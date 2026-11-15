// The owner's monetisation: a sponsor page may open alongside a download.
//
// Rules, all enforced here so they can be tested without a browser:
//  - only from a CLICK that also opens a download (never on page load, never
//    inside the player);
//  - only when DOWNLOAD_AD_URL is configured;
//  - at most once per DOWNLOAD_AD_INTERVAL_MIN (0 = every click);
//  - a blocked popup is ignored silently and never blocks the download.

export type AdConfig = { url: string; intervalMin: number };

export const AD_LAST_OPENED_KEY = "kumori.download.ad.last";

/** Has the interval passed? `lastAt` is epoch ms from localStorage, 0 if never. */
export function shouldOpenAd(
  ad: AdConfig | null | undefined,
  now: number,
  lastAt: number,
): boolean {
  if (!ad || !ad.url) return false;
  if (!Number.isFinite(lastAt) || lastAt <= 0) return true;
  if (ad.intervalMin <= 0) return true;
  return now - lastAt >= ad.intervalMin * 60_000;
}

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

/**
 * Opens the sponsor page from the SAME click handler as the download link.
 * Returns true when a window was opened. Every storage/popup error is swallowed:
 * a blocked ad must never stop the download or throw into React.
 */
export function openSponsoredPage(
  ad: AdConfig | null | undefined,
  options: {
    now: number;
    storage?: StorageLike | null;
    open?: ((url: string, target: string, features: string) => unknown) | null;
  },
): boolean {
  if (!ad || !ad.url) return false;
  const storage = options.storage ?? null;
  let lastAt = 0;
  try {
    const raw = storage?.getItem(AD_LAST_OPENED_KEY);
    const parsed = Number(raw);
    lastAt = Number.isFinite(parsed) ? parsed : 0;
  } catch {
    lastAt = 0;
  }
  if (!shouldOpenAd(ad, options.now, lastAt)) return false;

  try {
    const open = options.open ?? (typeof window !== "undefined" ? window.open.bind(window) : null);
    if (!open) return false;
    const opened = open(ad.url, "_blank", "noopener");
    // A blocked popup returns null: nothing happened, and nothing is recorded,
    // so the next click may try again inside the interval.
    if (opened === null || opened === undefined) return false;
    try {
      storage?.setItem(AD_LAST_OPENED_KEY, String(options.now));
    } catch {
      /* private mode / quota: the ad frequency simply is not remembered */
    }
    return true;
  } catch {
    return false;
  }
}
