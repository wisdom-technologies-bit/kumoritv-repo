/**
 * Should a playlist rewrite leave a media segment ABSOLUTE (straight from the
 * CDN) instead of routing it through this server?
 *
 * Only when ALL of these hold:
 *  - the operator listed the segment's host in `DIRECT_SEGMENT_HOSTS`;
 *  - the stream needs NO request header to be fetched.
 *
 * The second rule is the important one. AniKoto (MegaPlay) answers 403 on every
 * playlist, segment and subtitle unless the request carries
 * `Referer: https://megaplay.buzz/` - and a browser cannot be told to send a
 * Referer to a third-party CDN. A direct segment would therefore 403 in the
 * viewer's player, so whenever the signed payload carries a Referer every child
 * URL stays proxied, whatever the host list says.
 */

/** True when the signed payload asks the proxy to send a Referer upstream. */
export function payloadNeedsReferer(
  headers: Record<string, string> | undefined | null,
): boolean {
  if (!headers) return false;
  return Object.keys(headers).some(
    (name) =>
      name.toLowerCase() === "referer" &&
      String((headers as Record<string, string>)[name] || "").trim().length > 0,
  );
}

/** Resolve the effective direct-segment allow-list for one rewrite. */
export function directSegmentHostsFor(
  headers: Record<string, string> | undefined | null,
  listed: string[],
): string[] {
  if (payloadNeedsReferer(headers)) return [];
  return listed;
}

/** Is this segment URL on a host we may serve directly? */
export function directSegmentUrl(
  url: string,
  base: string,
  hosts: string[],
): string | null {
  if (!hosts.length) return null;
  let absolute: URL;
  try {
    absolute = new URL(url, base);
  } catch {
    return null;
  }
  if (absolute.protocol !== "https:") return null;
  const host = absolute.hostname.toLowerCase();
  const listed = hosts.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
  return listed ? absolute.toString() : null;
}
