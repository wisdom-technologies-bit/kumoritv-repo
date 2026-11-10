// Prompt 33 Part B - the week window a schedule request needs.
//
// AniList only answers "what airs between these two timestamps", so the page
// asks for a Monday-to-Sunday week in UTC plus a one day margin on each side.
// The margin is what makes every viewer's local days COMPLETE: a 23:30 UTC
// episode belongs to the next day in Lagos and Tokyo, and to the previous day
// in Los Angeles. The client then trims the window to the viewer's own days.
//
// Pure on purpose: no Intl, no Date.now(). `now` is always passed in.

export const DAY_MS = 86_400_000;
export const DAY_SECONDS = 86_400;
/** How far the arrows may walk away from the current week. */
export const MAX_WEEKS_BACK = 2;
export const MAX_WEEKS_AHEAD = 3;
/** One day either side, so no viewer time zone loses the edge of a day. */
export const WINDOW_MARGIN_DAYS = 1;

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `2026-11-09` -> itself, when it is a real calendar day; otherwise null. */
export function parseIsoDay(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = ISO_DAY.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  // Rejects 2026-02-31 and friends: the round trip has to come back identical.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/** Unix seconds -> `YYYY-MM-DD` in UTC. */
export function isoDayFromUnix(unixSeconds: number): string {
  return new Date(Math.floor(unixSeconds) * 1000).toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` -> unix seconds at 00:00:00 UTC. */
export function unixFromIsoDay(day: string): number {
  const parsed = parseIsoDay(day);
  if (!parsed) return Number.NaN;
  return Date.UTC(
    Number(parsed.slice(0, 4)),
    Number(parsed.slice(5, 7)) - 1,
    Number(parsed.slice(8, 10)),
  ) / 1000;
}

/** Calendar-day arithmetic that never touches a local time zone. */
export function addDays(day: string, amount: number): string {
  const base = unixFromIsoDay(day);
  if (!Number.isFinite(base)) return day;
  return new Date((base + amount * DAY_SECONDS) * 1000).toISOString().slice(0, 10);
}

/** 0 = Monday ... 6 = Sunday (the schedule week starts on Monday). */
export function dayOfWeek(day: string): number {
  const base = unixFromIsoDay(day);
  if (!Number.isFinite(base)) return 0;
  return (new Date(base * 1000).getUTCDay() + 6) % 7;
}

/** The Monday of the week that contains `day`. */
export function weekStart(day: string): string {
  return addDays(day, -dayOfWeek(day));
}

/** The seven days of a week, Monday first. */
export function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

export type WeekWindow = {
  /** Monday, UTC. */
  weekStart: string;
  /** Sunday, UTC. */
  weekEnd: string;
  /** The seven week days, Monday first. */
  days: string[];
  /** Fetch bounds, in unix seconds, INCLUDING the margin. */
  fromUnix: number;
  toUnix: number;
  /** What the margin actually buys, for the report and the tests. */
  marginDays: number;
};

export function buildWeekWindow(start: string, marginDays = WINDOW_MARGIN_DAYS): WeekWindow {
  const monday = weekStart(start);
  const sunday = addDays(monday, 6);
  return {
    weekStart: monday,
    weekEnd: sunday,
    days: weekDays(monday),
    fromUnix: unixFromIsoDay(monday) - marginDays * DAY_SECONDS,
    // 23:59:59 on the day after Sunday, so the whole margin day is included.
    toUnix: unixFromIsoDay(sunday) + (marginDays + 1) * DAY_SECONDS - 1,
    marginDays,
  };
}

export function isDayInWeek(day: string, start: string): boolean {
  const monday = weekStart(start);
  return day >= monday && day <= addDays(monday, 6);
}

export type ScheduleQueryParams = { week?: string; w?: string; day?: string };

export type ResolvedSchedule = {
  /** Monday of the week being shown. */
  weekStart: string;
  days: string[];
  /** The day the timeline opens on. */
  selectedDay: string;
  /** Whole weeks from the current week: -2 .. +3. */
  offset: number;
  window: WeekWindow;
  hasPrev: boolean;
  hasNext: boolean;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * `?w=` wins over `?week=` (an explicit week is more specific), and anything
 * malformed falls back to the current week instead of erroring: a bad URL must
 * never blank the page.
 */
export function resolveScheduleQuery(params: ScheduleQueryParams = {}, nowUnixSeconds: number): ResolvedSchedule {
  const nowDay = isoDayFromUnix(nowUnixSeconds);
  const currentWeek = weekStart(nowDay);

  let requested = currentWeek;
  if (params.week === 'prev') requested = addDays(currentWeek, -7);
  else if (params.week === 'next') requested = addDays(currentWeek, 7);

  const explicit = parseIsoDay(params.w);
  if (explicit) requested = weekStart(explicit);

  const rawOffset = Math.round((unixFromIsoDay(requested) - unixFromIsoDay(currentWeek)) / (7 * DAY_SECONDS));
  const offset = clamp(Number.isFinite(rawOffset) ? rawOffset : 0, -MAX_WEEKS_BACK, MAX_WEEKS_AHEAD);
  const start = addDays(currentWeek, offset * 7);

  const requestedDay = parseIsoDay(params.day);
  const selectedDay =
    requestedDay && isDayInWeek(requestedDay, start)
      ? requestedDay
      : isDayInWeek(nowDay, start)
        ? nowDay
        : start;

  return {
    weekStart: start,
    days: weekDays(start),
    selectedDay,
    offset,
    window: buildWeekWindow(start),
    hasPrev: offset > -MAX_WEEKS_BACK,
    hasNext: offset < MAX_WEEKS_AHEAD,
  };
}
