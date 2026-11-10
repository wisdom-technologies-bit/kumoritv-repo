// Prompt 33 Part B - the viewer's clock.
//
// Every day boundary, "today", the day pills, the countdowns and the hourly
// grouping are computed HERE, on the client, from the raw `airingAt` timestamps.
// The server never renders a day or a time, so nothing can flip after
// hydration.
//
// `Intl.DateTimeFormat` is the only time-zone arithmetic used: it is the one API
// that knows about DST rules and half-hour offsets (Asia/Kathmandu, UTC+5:45)
// without shipping a tz database of our own.

import { addDays, dayOfWeek, weekStart } from './window';

export const AIRING_NOW_WINDOW_SECONDS = 30 * 60;

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  formatters.set(timeZone, created);
  return created;
}

export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/** The wall-clock reading of `unixSeconds` in `timeZone`. */
export function zonedParts(unixSeconds: number, timeZone: string): ZonedParts {
  const date = new Date(Math.floor(unixSeconds) * 1000);
  const out: Partial<ZonedParts> = {};
  for (const part of partsFormatter(timeZone).formatToParts(date)) {
    if (part.type === 'year') out.year = Number(part.value);
    else if (part.type === 'month') out.month = Number(part.value);
    else if (part.type === 'day') out.day = Number(part.value);
    else if (part.type === 'hour') out.hour = Number(part.value);
    else if (part.type === 'minute') out.minute = Number(part.value);
    else if (part.type === 'second') out.second = Number(part.value);
  }
  return {
    year: out.year ?? 1970,
    month: out.month ?? 1,
    day: out.day ?? 1,
    // Some engines answer 24 for midnight even with h23; normalise it.
    hour: (out.hour ?? 0) % 24,
    minute: out.minute ?? 0,
    second: out.second ?? 0,
  };
}

const pad = (value: number) => String(value).padStart(2, '0');

/** `YYYY-MM-DD` of the LOCAL day `unixSeconds` falls on. */
export function localDayKey(unixSeconds: number, timeZone: string): string {
  const { year, month, day } = zonedParts(unixSeconds, timeZone);
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** `HH:mm` in the viewer's zone. */
export function localTimeLabel(unixSeconds: number, timeZone: string): string {
  const { hour, minute } = zonedParts(unixSeconds, timeZone);
  return `${pad(hour)}:${pad(minute)}`;
}

/** `HH:mm` of the hour slot a card is filed under. */
export function hourSlotLabel(unixSeconds: number, timeZone: string): string {
  const { hour } = zonedParts(unixSeconds, timeZone);
  return `${pad(hour)}:00`;
}

/** What "today" means for this viewer, as an ISO day. */
export function localToday(nowUnixSeconds: number, timeZone: string): string {
  return localDayKey(nowUnixSeconds, timeZone);
}

/** Monday of the viewer's own local week. */
export function localWeekStart(nowUnixSeconds: number, timeZone: string): string {
  return weekStart(localToday(nowUnixSeconds, timeZone));
}

/** The seven local days of the week that contains `day`. */
export function localWeekDays(day: string): string[] {
  const start = weekStart(day);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

export type GroupedSchedule<T> = Array<{ day: string; items: T[] }>;

/**
 * Buckets items by the viewer's local day, keeping chronological order inside
 * each bucket. Days with nothing in them are present with an empty list so the
 * page can render "Nothing airing on this day" without a second pass.
 */
export function groupByLocalDay<T>(
  items: T[],
  timeZone: string,
  getUnix: (item: T) => number,
  days?: string[],
): GroupedSchedule<T> {
  const buckets = new Map<string, T[]>();
  for (const day of days ?? []) buckets.set(day, []);

  for (const item of items ?? []) {
    const unix = getUnix(item);
    if (!Number.isFinite(unix)) continue;
    const key = localDayKey(unix, timeZone);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }

  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => getUnix(a) - getUnix(b));
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, list]) => ({ day, items: list }));
}

/** Groups a day's items into hour slots ("08:00", "09:30", ...). */
export function groupByHourSlot<T>(
  items: T[],
  timeZone: string,
  getUnix: (item: T) => number,
): Array<{ slot: string; items: T[] }> {
  const buckets = new Map<string, T[]>();
  for (const item of items ?? []) {
    const unix = getUnix(item);
    if (!Number.isFinite(unix)) continue;
    const slot = hourSlotLabel(unix, timeZone);
    const bucket = buckets.get(slot);
    if (bucket) bucket.push(item);
    else buckets.set(slot, [item]);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([slot, list]) => ({ slot, items: list.sort((a, b) => getUnix(a) - getUnix(b)) }));
}

export type AiringStatus = {
  state: 'upcoming' | 'airing' | 'aired';
  /** Whole seconds until the start (negative once it started). */
  secondsUntil: number;
  /** `Airing in 2h 14m` / `Airing now` / `Aired`. */
  label: string;
};

/** `2h 14m`, `3d 4h`, `45m`, `12s`. Days and hours are never shown together with seconds. */
export function countdownLabel(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${total}s`;
}

/**
 * `Airing in ...` before the start, `Airing now` for the 30 minutes after it,
 * `Aired` afterwards. Never "just aired": aired is aired.
 */
export function statusOf(airingAt: number, nowUnixSeconds: number): AiringStatus {
  const secondsUntil = Math.floor(airingAt) - Math.floor(nowUnixSeconds);
  if (secondsUntil > 0) {
    return { state: 'upcoming', secondsUntil, label: `Airing in ${countdownLabel(secondsUntil)}` };
  }
  if (-secondsUntil < AIRING_NOW_WINDOW_SECONDS) {
    return { state: 'airing', secondsUntil, label: 'Airing now' };
  }
  return { state: 'aired', secondsUntil, label: 'Aired' };
}

// `Intl` only knows a real abbreviation for some zones: it answers "GMT+1" for
// Lagos and "GMT+9" for Tokyo, where a schedule should say WAT and JST. A short
// curated table covers the zones that reach us; anything else keeps the offset,
// which is never wrong, only less friendly.
const ZONE_ABBREVIATIONS: Record<string, string> = {
  "Africa/Lagos": "WAT",
  "Africa/Accra": "GMT",
  "Africa/Nairobi": "EAT",
  "Africa/Johannesburg": "SAST",
  "Africa/Cairo": "EET",
  "Asia/Tokyo": "JST",
  "Asia/Seoul": "KST",
  "Asia/Shanghai": "CST",
  "Asia/Hong_Kong": "HKT",
  "Asia/Taipei": "CST",
  "Asia/Singapore": "SGT",
  "Asia/Manila": "PHT",
  "Asia/Jakarta": "WIB",
  "Asia/Bangkok": "ICT",
  "Asia/Ho_Chi_Minh": "ICT",
  "Asia/Kuala_Lumpur": "MYT",
  "Asia/Kolkata": "IST",
  "Asia/Kathmandu": "NPT",
  "Asia/Dhaka": "BST",
  "Asia/Karachi": "PKT",
  "Asia/Dubai": "GST",
  "Asia/Riyadh": "AST",
  "America/Los_Angeles": "PT",
  "America/Sao_Paulo": "BRT",
  "America/Argentina/Buenos_Aires": "ART",
  "America/Bogota": "COT",
  "America/Lima": "PET",
  "Australia/Sydney": "AEST",
  "Australia/Perth": "AWST",
  "Pacific/Auckland": "NZST",
  "Pacific/Kiritimati": "LINT",
  "Europe/Istanbul": "TRT",
  "Europe/Moscow": "MSK",
};

const zoneNames = new Map<string, string>();

/** Short zone name + offset for a zone at an instant: `WAT, UTC+01:00`. */
export function zoneOffsetLabel(timeZone: string, unixSeconds: number): string {
  const cacheKey = `${timeZone}@${Math.floor(unixSeconds / 900)}`;
  const cached = zoneNames.get(cacheKey);
  if (cached) return cached;

  const date = new Date(Math.floor(unixSeconds) * 1000);
  let name = '';
  let offset = '';
  try {
    const short =
      new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
        .formatToParts(date)
        .find((part) => part.type === 'timeZoneName')?.value ?? '';
    // "GMT+1" is an offset wearing a name; the table knows the real one.
    name = /^GMT[+-]?\d*$|^$/.test(short) ? (ZONE_ABBREVIATIONS[timeZone] ?? '') : short;
    offset =
      new Intl.DateTimeFormat('en-GB', { timeZone, timeZoneName: 'longOffset' })
        .formatToParts(date)
        .find((part) => part.type === 'timeZoneName')?.value.replace('GMT', 'UTC') ?? '';
    if (offset === 'UTC') offset = 'UTC+00:00';
  } catch {
    return timeZone;
  }

  const label = [name, offset].filter(Boolean).join(', ');
  zoneNames.set(cacheKey, label);
  return label || timeZone;
}

/** `Africa/Lagos (WAT, UTC+01:00)` - the line above the timeline. */
export function zoneLine(timeZone: string, unixSeconds: number): string {
  const details = zoneOffsetLabel(timeZone, unixSeconds);
  return details && details !== timeZone ? `${timeZone} (${details})` : timeZone;
}

/** `Mon` for a `YYYY-MM-DD`, independent of any time zone. */
export function weekdayShort(day: string): string {
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return names[dayOfWeek(day)] ?? '';
}

/** `9` -> `Nov 9`. */
export function dayMonthLabel(day: string): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = Number(day.slice(5, 7));
  return `${months[month - 1] ?? ''} ${Number(day.slice(8, 10))}`;
}
