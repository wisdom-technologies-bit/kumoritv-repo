/** Short "1 week ago" style stamps for comment rows. */
export function formatTimeAgo(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";

  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 45) return "just now";

  const units: { seconds: number; name: string }[] = [
    { seconds: 60, name: "minute" },
    { seconds: 3600, name: "hour" },
    { seconds: 86400, name: "day" },
    { seconds: 604800, name: "week" },
    { seconds: 2629800, name: "month" },
    { seconds: 31557600, name: "year" },
  ];

  let chosen = units[0];
  for (const unit of units) {
    if (seconds >= unit.seconds) chosen = unit;
  }

  const value = Math.max(1, Math.floor(seconds / chosen.seconds));
  return `${value} ${chosen.name}${value === 1 ? "" : "s"} ago`;
}
