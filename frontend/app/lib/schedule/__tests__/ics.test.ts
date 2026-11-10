// Prompt 33 Part B - the .ics builders.
//
// Calendar clients are unforgiving: CRLF, 75-octet folding, escaped TEXT, UTC
// (Z) times and a stable UID. A reminder 15 minutes before the episode is part
// of the contract.
import assert from "node:assert/strict";
import test from "node:test";
import {
  ICS_MAX_DAYS,
  ICS_MAX_IDS,
  buildIcs,
  escapeIcsText,
  foldIcsLine,
  formatIcsUtc,
  parseDaysParam,
  parseIdsParam,
} from "@/app/lib/schedule/ics";
import type { ScheduleItem } from "@/app/lib/schedule/types";

const NOW = Math.floor(Date.UTC(2026, 10, 10, 20, 0, 0) / 1000);

function item(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id: 1,
    airingAt: NOW + 3600,
    episode: 5,
    media: {
      id: 21,
      title: { english: "One Piece" },
      episodes: 1100,
      duration: 24,
    },
    ...overrides,
  } as ScheduleItem;
}

test("ids are validated, deduped and capped at 50", () => {
  assert.deepEqual(parseIdsParam("21,16498"), [21, 16498]);
  assert.deepEqual(parseIdsParam(" 21 , 21 , 16498 "), [21, 16498], "duplicates collapse");
  assert.deepEqual(parseIdsParam("21,abc,-4,0,null"), [21], "garbage never reaches AniList");
  assert.deepEqual(parseIdsParam(""), []);
  assert.deepEqual(parseIdsParam(undefined), []);
  assert.equal(parseIdsParam(Array.from({ length: 80 }, (_, index) => index + 1).join(",")).length, ICS_MAX_IDS);
});

test("days are clamped, never trusted", () => {
  assert.equal(parseDaysParam("14"), 14);
  assert.equal(parseDaysParam("0"), 1);
  assert.equal(parseDaysParam("999"), ICS_MAX_DAYS);
  assert.equal(parseDaysParam("abc", 14), 14);
  assert.equal(parseDaysParam(undefined, 7), 7);
});

test("TEXT is escaped the way RFC 5545 asks", () => {
  assert.equal(escapeIcsText("a;b,c"), "a\\;b\\,c");
  assert.equal(escapeIcsText("line1\nline2"), "line1\\nline2");
  assert.equal(escapeIcsText("back\\slash"), "back\\\\slash");
  assert.equal(escapeIcsText(undefined), "");
});

test("long lines fold at 75 octets and never split a UTF-8 sequence", () => {
  const folded = foldIcsLine("DESCRIPTION:" + "x".repeat(200));
  const lines = folded.split("\r\n");
  assert.equal(lines.length, 3, "212 octets at 75 per line");
  assert.ok(lines.every((line) => Buffer.byteLength(line, "utf8") <= 75));
  assert.ok(lines.slice(1).every((line) => line.startsWith(" ")));

  const emoji = foldIcsLine("SUMMARY:" + "🎬".repeat(40));
  for (const line of emoji.split("\r\n")) {
    assert.ok(Buffer.byteLength(line, "utf8") <= 75);
    assert.equal(line.includes("\ufffd"), false, "no broken code point");
  }
  assert.equal(foldIcsLine("SHORT:1").includes("\r\n"), false);
});

test("times are written in UTC", () => {
  assert.equal(formatIcsUtc(Date.UTC(2026, 10, 10, 21, 0, 0) / 1000), "20261110T210000Z");
  assert.match(formatIcsUtc(NOW), /^\d{8}T\d{6}Z$/);
});

test("the calendar has CRLF, a PRODID, one VEVENT per episode and a 15 minute alarm", () => {
  const ics = buildIcs({
    items: [item(), item({ id: 2, airingAt: NOW + 7200, episode: 6 })],
    siteUrl: "https://kumoritv.top",
    nowUnixSeconds: NOW,
  });

  assert.ok(ics.endsWith("\r\n"));
  assert.equal(ics.includes("\n\n"), false, "no bare newlines");
  assert.match(ics, /^BEGIN:VCALENDAR\r\nVERSION:2.0\r\n/);
  assert.match(ics, /PRODID:-\/\/KumoriTV\/\/Release Schedule\/\/EN/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 2);
  assert.equal((ics.match(/BEGIN:VALARM/g) ?? []).length, 2);
  assert.match(ics, /TRIGGER:-PT15M/);
  assert.match(ics, new RegExp(`DTSTART:${formatIcsUtc(NOW + 3600)}`));
  assert.match(ics, /SUMMARY:One Piece - Episode 5/);
  assert.match(ics, /DESCRIPTION:Episode 5 of 1100\./);
  assert.match(ics, /URL:https:\/\/kumoritv\.top\/watch\/21\?episode=5/);
  assert.match(ics, /UID:episode-21-5-\d+@kumoritv/);
  assert.match(ics, /DURATION:PT24M/);
  assert.match(ics, /END:VCALENDAR/);
});

test("the same input gives the same file, and only inside the horizon", () => {
  const args = { items: [item(), item({ id: 2, airingAt: NOW + 40 * 86_400 })], siteUrl: "https://kumoritv.top", nowUnixSeconds: NOW, days: 14 };
  const first = buildIcs(args);
  const second = buildIcs(args);
  assert.equal(first, second);
  assert.equal((first.match(/BEGIN:VEVENT/g) ?? []).length, 1, "the 40-day-out episode is outside the window");
});

test("a title with a comma and a semicolon stays one SUMMARY", () => {
  const ics = buildIcs({
    items: [item({ media: { id: 7, title: { english: "Frieren; Beyond, Journey's End" }, episodes: 28 } })],
    siteUrl: "https://kumoritv.top",
    nowUnixSeconds: NOW,
  });
  const summary = ics.split("\r\n").find((line) => line.startsWith("SUMMARY:"));
  assert.ok(summary);
  assert.equal(summary, "SUMMARY:Frieren\\; Beyond\\, Journey's End - Episode 5");
});
