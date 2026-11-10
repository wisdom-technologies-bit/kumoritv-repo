// Prompt 33 Part B - the viewer's clock.
//
// The same raw dataset has to group into different local days in different
// zones. These tests pin the four cases that actually break schedule pages:
// a 23:30 UTC episode (next day in Lagos and Tokyo), UTC+14 (the day after
// everywhere else), UTC-8/7, and both DST transitions.
import assert from "node:assert/strict";
import test from "node:test";
import {
  AIRING_NOW_WINDOW_SECONDS,
  countdownLabel,
  groupByHourSlot,
  groupByLocalDay,
  hourSlotLabel,
  localDayKey,
  localTimeLabel,
  localToday,
  localWeekDays,
  localWeekStart,
  statusOf,
  weekdayShort,
  zoneLine,
  zonedParts,
} from "@/app/lib/schedule/local";

const at = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

const LAGOS = "Africa/Lagos";
const TOKYO = "Asia/Tokyo";
const LA = "America/Los_Angeles";
const KIRITIMATI = "Pacific/Kiritimati"; // UTC+14, no DST

type Row = { id: number; airingAt: number };

// 23:30 UTC on 10 November 2026. Already the 11th in Lagos and Tokyo.
const LATE_NIGHT: Row[] = [
  { id: 1, airingAt: at("2026-11-10T23:30:00Z") },
  { id: 2, airingAt: at("2026-11-10T12:00:00Z") },
  { id: 3, airingAt: at("2026-11-11T00:30:00Z") },
];

test("a 23:30 UTC episode belongs to the NEXT day east of UTC", () => {
  assert.equal(localDayKey(LATE_NIGHT[0]!.airingAt, LAGOS), "2026-11-11");
  assert.equal(localDayKey(LATE_NIGHT[0]!.airingAt, TOKYO), "2026-11-11");
  // ...and to the SAME day west of it.
  assert.equal(localDayKey(LATE_NIGHT[0]!.airingAt, LA), "2026-11-10");
});

test("UTC+14 sees tomorrow first", () => {
  assert.equal(localDayKey(at("2026-11-10T23:30:00Z"), KIRITIMATI), "2026-11-11");
  assert.equal(localDayKey(at("2026-11-10T09:59:00Z"), KIRITIMATI), "2026-11-10");
  assert.equal(localDayKey(at("2026-11-10T10:00:00Z"), KIRITIMATI), "2026-11-11", "10:00 UTC is midnight +14");
});

test("the same dataset groups into different days per zone", () => {
  const lagos = groupByLocalDay(LATE_NIGHT, LAGOS, (row) => row.airingAt);
  const la = groupByLocalDay(LATE_NIGHT, LA, (row) => row.airingAt);

  // Lagos: 12:00Z stays on the 10th, 23:30Z and 00:30Z are the 11th.
  assert.deepEqual(
    lagos.map((group) => [group.day, group.items.map((row) => row.id)]),
    [
      ["2026-11-10", [2]],
      ["2026-11-11", [1, 3]],
    ],
  );
  // Los Angeles (UTC-8 in November): all three still fall on the 10th, in
  // chronological order, so the same rows produce ONE day here and TWO there.
  assert.deepEqual(
    la.map((group) => [group.day, group.items.map((row) => row.id)]),
    [["2026-11-10", [2, 1, 3]]],
  );
  // UTC+14: everything lands on the 11th, still chronological.
  assert.deepEqual(
    groupByLocalDay(LATE_NIGHT, KIRITIMATI, (row) => row.airingAt).map((group) => [group.day, group.items.map((row) => row.id)]),
    [["2026-11-11", [2, 1, 3]]],
  );
});

test("grouping keeps order, respects the listed days and never invents them", () => {
  const days = ["2026-11-09", "2026-11-10", "2026-11-11"];
  const grouped = groupByLocalDay(LATE_NIGHT, LAGOS, (row) => row.airingAt, days);
  assert.deepEqual(
    grouped.map((group) => group.day),
    days,
    "only the requested days, Monday first, empty ones included",
  );
  assert.deepEqual(grouped[2]!.items.map((row) => row.id), [1, 3]);

  const unsorted = [3, 1, 2].map((id) => LATE_NIGHT.find((row) => row.id === id)!);
  assert.deepEqual(
    groupByLocalDay(unsorted, LAGOS, (row) => row.airingAt)[0]!.items.map((row) => row.id),
    [2],
  );
});

test("midnight boundaries land on the right side", () => {
  assert.equal(localDayKey(at("2026-11-10T23:59:59Z"), LAGOS), "2026-11-11");
  assert.equal(localDayKey(at("2026-11-10T23:00:00Z"), LAGOS), "2026-11-11", "00:00 in Lagos");
  assert.equal(localDayKey(at("2026-11-10T22:59:00Z"), LAGOS), "2026-11-10");
});

test("DST transitions keep the local day and the local time honest", () => {
  // America/Los_Angeles falls back on 1 November 2026: 09:00 UTC is 02:00 PDT,
  // 10:00 UTC is 01:00 PST. Both are still the 1st.
  assert.equal(localTimeLabel(at("2026-11-01T08:30:00Z"), LA), "01:30");
  assert.equal(localTimeLabel(at("2026-11-01T09:30:00Z"), LA), "01:30", "the repeated hour");
  assert.equal(localDayKey(at("2026-11-01T09:30:00Z"), LA), "2026-11-01");

  // Spring forward on 8 March 2026: 10:00 UTC jumps 02:00 -> 03:00.
  assert.equal(localTimeLabel(at("2026-03-08T09:59:00Z"), LA), "01:59");
  assert.equal(localTimeLabel(at("2026-03-08T10:00:00Z"), LA), "03:00");
  assert.equal(localDayKey(at("2026-03-08T10:00:00Z"), LA), "2026-03-08");
});

test("local week helpers are pure calendar maths on the local day", () => {
  const now = at("2026-11-10T23:30:00Z"); // the 11th in Lagos
  assert.equal(localToday(now, LAGOS), "2026-11-11");
  assert.equal(localWeekStart(now, LAGOS), "2026-11-09");
  assert.deepEqual(localWeekDays("2026-11-11"), [
    "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15",
  ]);
  assert.equal(weekdayShort("2026-11-09"), "Mon");
  assert.equal(weekdayShort("2026-11-15"), "Sun");
});

test("countdown text is short, human and never negative", () => {
  assert.equal(countdownLabel(2 * 3600 + 14 * 60), "2h 14m");
  assert.equal(countdownLabel(3 * 86_400 + 4 * 3600), "3d 4h");
  assert.equal(countdownLabel(45 * 60), "45m");
  assert.equal(countdownLabel(12), "12s");
  assert.equal(countdownLabel(-50), "0s");
});

test("status: Airing in, Airing now for 30 minutes, then Aired", () => {
  const start = at("2026-11-10T20:00:00Z");

  assert.deepEqual(statusOf(start, start - 8040), {
    state: "upcoming",
    secondsUntil: 8040,
    label: "Airing in 2h 14m",
  });
  assert.equal(statusOf(start, start).label, "Airing now");
  assert.equal(statusOf(start, start + AIRING_NOW_WINDOW_SECONDS - 1).label, "Airing now");
  assert.equal(statusOf(start, start + AIRING_NOW_WINDOW_SECONDS).label, "Aired", "30 minutes is the line");
  assert.equal(statusOf(start, start + 86_400).state, "aired");
});

test("hour slots are the viewer's local hours", () => {
  const row = { airingAt: at("2026-11-10T23:30:00Z") };
  assert.equal(hourSlotLabel(row.airingAt, LAGOS), "00:00");
  assert.equal(localTimeLabel(row.airingAt, LAGOS), "00:30");
  assert.equal(hourSlotLabel(row.airingAt, TOKYO), "08:00");

  const slots = groupByHourSlot(
    [
      { airingAt: at("2026-11-10T08:10:00Z") },
      { airingAt: at("2026-11-10T08:50:00Z") },
      { airingAt: at("2026-11-10T09:30:00Z") },
    ],
    LAGOS,
    (item) => item.airingAt,
  );
  assert.deepEqual(
    slots.map((slot) => [slot.slot, slot.items.length]),
    [
      ["09:00", 2],
      ["10:00", 1],
    ],
  );
});

test("the zone line names the zone and its offset", () => {
  const now = at("2026-11-10T20:59:00Z");
  assert.equal(zoneLine(LAGOS, now), "Africa/Lagos (WAT, UTC+01:00)");
  assert.match(zoneLine(TOKYO, now), /Asia\/Tokyo \(.*UTC\+09:00\)/);
  // Los Angeles is on standard time in November.
  assert.match(zoneLine(LA, now), /UTC-08:00/);
  assert.match(zoneLine("UTC", now), /UTC\+00:00/);
});

test("zonedParts normalises midnight to hour 0", () => {
  const parts = zonedParts(at("2026-11-10T23:00:00Z"), LAGOS);
  assert.equal(parts.hour, 0, "never 24");
  assert.equal(parts.minute, 0);
  assert.equal(parts.day, 11);
  assert.equal(parts.month, 11);
  assert.equal(parts.year, 2026);
});
