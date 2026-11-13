/**
 * Removes the two values a watch response cannot share between two runs by
 * design: the wall clock (`resolvedAt`) and the signed proxy token (which
 * carries its own expiry). Everything else is compared verbatim, which is what
 * makes the "flag off is identical to master" snapshot meaningful.
 */
export function normaliseWatchResponse(body: any): any {
  const clone = JSON.parse(JSON.stringify(body));
  const scrub = (value: unknown) =>
    typeof value === "string" ? value.replace(/([?&]t=)[^&]+/, "$1<token>") : value;
  if (typeof clone.resolvedAt === "string") clone.resolvedAt = "<resolvedAt>";
  clone.url = scrub(clone.url);
  if (Array.isArray(clone.subtitles))
    clone.subtitles = clone.subtitles.map((track: any) => ({
      ...track,
      url: scrub(track.url),
    }));
  return clone;
}
