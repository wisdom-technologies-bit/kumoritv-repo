// Prompt 33 Part B - the .ics calendar for "Add to calendar" and the
// "Subscribe to calendar" link.
//
// RFC 5545 details that actually matter to a calendar app: CRLF line endings,
// 75-OCTET folding, escaped TEXT values, UTC (Z) times, a stable UID per
// episode, and a VALARM 15 minutes before the start. Pure: `now` is passed in.

import { displayTitle } from '@/app/lib/titles';
import type { ScheduleItem } from './types';

export const ICS_MAX_IDS = 50;
export const ICS_MAX_DAYS = 14;
export const ICS_DEFAULT_DURATION_MINUTES = 24;
export const ICS_ALARM_MINUTES = 15;

const PRODUCT_ID = '-//KumoriTV//Release Schedule//EN';

/**
 * `?ids=1,2,3` -> `[1,2,3]`. Anything else (empty, words, negatives, more than
 * ICS_MAX_IDS entries) is dropped instead of throwing: a bad link must not 500.
 */
export function parseIdsParam(value: unknown): number[] {
  const raw = Array.isArray(value) ? value.join(',') : typeof value === 'string' ? value : '';
  const ids: number[] = [];
  for (const piece of raw.split(',')) {
    const id = Number(piece.trim());
    if (!Number.isInteger(id) || id <= 0 || id > 1_000_000_000) continue;
    if (ids.includes(id)) continue;
    ids.push(id);
    if (ids.length >= ICS_MAX_IDS) break;
  }
  return ids;
}

/** `days` is clamped to 1..ICS_MAX_DAYS; junk becomes the default. */
export function parseDaysParam(value: unknown, fallback = ICS_MAX_DAYS): number {
  const days = Number(Array.isArray(value) ? value[0] : value);
  if (!Number.isFinite(days)) return fallback;
  return Math.min(ICS_MAX_DAYS, Math.max(1, Math.floor(days)));
}

/** RFC 5545 TEXT escaping: backslash, semicolon, comma, newline. */
export function escapeIcsText(value: unknown): string {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Folds a content line at 75 octets, continuation lines start with one space. */
export function foldIcsLine(line: string, limit = 75): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= limit) return line;
  const out: string[] = [];
  let start = 0;
  let first = true;
  while (start < bytes.length) {
    const size = first ? limit : limit - 1;
    let end = Math.min(bytes.length, start + size);
    // Never split a UTF-8 sequence: step back off continuation bytes.
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end -= 1;
    out.push((first ? '' : ' ') + bytes.subarray(start, end).toString('utf8'));
    start = end;
    first = false;
  }
  return out.join('\r\n');
}

/** Unix seconds -> `20261110T210000Z`. */
export function formatIcsUtc(unixSeconds: number): string {
  return `${new Date(Math.floor(unixSeconds) * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`;
}

export function eventUid(item: ScheduleItem): string {
  return `episode-${item.media.id}-${item.episode}-${item.airingAt}@kumoritv`;
}

export type IcsBuildOptions = {
  items: ScheduleItem[];
  siteUrl: string;
  nowUnixSeconds: number;
  calendarName?: string;
  /** Keep only episodes starting inside this many days from now. */
  days?: number;
};

/** The full VCALENDAR. Deterministic: the same input gives the same file. */
export function buildIcs({ items, siteUrl, nowUnixSeconds, calendarName = 'KumoriTV Release Schedule', days = ICS_MAX_DAYS }: IcsBuildOptions): string {
  const base = siteUrl.replace(/\/$/, '');
  const horizon = nowUnixSeconds + days * 86_400;
  const events = (items ?? [])
    .filter((item) => item && item.airingAt >= nowUnixSeconds - 30 * 60 && item.airingAt <= horizon)
    .sort((a, b) => a.airingAt - b.airingAt);

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODUCT_ID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
  ];

  for (const item of events) {
    const title = displayTitle(item.media?.title);
    const url = `${base}/watch/${item.media.id}?episode=${item.episode}`;
    const minutes = Number(item.media?.duration) > 0 ? Number(item.media.duration) : ICS_DEFAULT_DURATION_MINUTES;
    const total = Number(item.media?.episodes ?? 0);
    const summary = `${title} - Episode ${item.episode}`;
    const description = total > 0 && total >= item.episode
      ? `Episode ${item.episode} of ${total}. Watch on KumoriTV: ${url}`
      : `Episode ${item.episode}. Watch on KumoriTV: ${url}`;

    lines.push(
      'BEGIN:VEVENT',
      `UID:${eventUid(item)}`,
      `DTSTAMP:${formatIcsUtc(nowUnixSeconds)}`,
      `DTSTART:${formatIcsUtc(item.airingAt)}`,
      `DURATION:PT${minutes}M`,
      `SUMMARY:${escapeIcsText(summary)}`,
      `DESCRIPTION:${escapeIcsText(description)}`,
      `URL:${url}`,
      'BEGIN:VALARM',
      `TRIGGER:-PT${ICS_ALARM_MINUTES}M`,
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeIcsText(summary)}`,
      'END:VALARM',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return lines.map((line) => foldIcsLine(line)).join('\r\n') + '\r\n';
}
