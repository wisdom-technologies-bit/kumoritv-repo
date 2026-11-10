// Prompt 33 Part B - the week window the schedule asks AniList for.
//
// The window is Monday-to-Sunday in UTC with a one day margin either side, so
// every viewer time zone gets complete local days. These are the guards for
// that arithmetic and for the URL parameters the page accepts.
import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_WEEKS_AHEAD,
  MAX_WEEKS_BACK,
  WINDOW_MARGIN_DAYS,
  addDays,
  buildWeekWindow,
  dayOfWeek,
  isDayInWeek,
  isoDayFromUnix,
  parseIsoDay,
  resolveScheduleQuery,
  unixFromIsoDay,
  weekDays,
  weekStart,
} from "@/app/lib/schedule/window";

// Tuesday 10 November 2026, 20:59 UTC.
const NOW = Math.floor(Date.UTC(2026, 10, 10, 20, 59, 0) / 1000);

test("parseIsoDay accepts real days and rejects everything else", () => {
  assert.equal(parseIsoDay("2026-11-10"), "2026-11-10");
  assert.equal(parseIsoDay(" 2026-11-10 "), "2026-11-10");
  assert.equal(parseIsoDay("2026-02-31"), null, "31 February is not a day");
  assert.equal(parseIsoDay("2026-13-01"), null);
  assert.equal(parseIsoDay("10/11/2026"), null);
  assert.equal(parseIsoDay("nope"), null);
  assert.equal(parseIsoDay(undefined), null);
  assert.equal(parseIsoDay(["2026-11-10"]), null, "arrays are not days");
});

test("day maths never drifts across a month, a leap day or a year", () => {
  assert.equal(addDays("2026-11-30", 1), "2026-12-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addDays("2026-11-10", -7), "2026-11-03");
});

test("the week starts on Monday and runs to Sunday", () => {
  assert.equal(dayOfWeek("2026-11-09"), 0, "9 November 2026 is a Monday");
  assert.equal(dayOfWeek("2026-11-15"), 6, "15 November is a Sunday");
  assert.equal(weekStart("2026-11-10"), "2026-11-09");
  assert.equal(weekStart("2026-11-09"), "2026-11-09");
  assert.equal(weekStart("2026-11-15"), "2026-11-09");
  assert.deepEqual(weekDays("2026-11-09"), [
    "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15",
  ]);
});

test("the window covers the week plus a one day margin on each side", () => {
  const window = buildWeekWindow("2026-11-10");
  assert.equal(window.weekStart, "2026-11-09");
  assert.equal(window.weekEnd, "2026-11-15");
  assert.equal(window.marginDays, WINDOW_MARGIN_DAYS);
  assert.equal(window.fromUnix, unixFromIsoDay("2026-11-08"), "starts the day before Monday");
  assert.equal(window.toUnix, unixFromIsoDay("2026-11-16") + 86_399, "ends 23:59:59 the day after Sunday");
  assert.equal(window.fromUnix % 86_400, 0);
});

test("every local day of the week fits inside the window", () => {
  const window = buildWeekWindow("2026-11-10");
  const firstMoment = weekDays(window.weekStart)[0]!;
  // The earliest instant that can belong to Monday anywhere is Monday 00:00 at
  // UTC+14 (Sunday 10:00 UTC); the latest is Monday 23:59 at UTC-12.
  assert.ok(unixFromIsoDay(firstMoment) - 14 * 3600 >= window.fromUnix);
  assert.ok(unixFromIsoDay("2026-11-15") + 86_399 + 12 * 3600 <= window.toUnix);
});

test("isDayInWeek only accepts the seven days it shows", () => {
  assert.equal(isDayInWeek("2026-11-09", "2026-11-09"), true);
  assert.equal(isDayInWeek("2026-11-15", "2026-11-09"), true);
  assert.equal(isDayInWeek("2026-11-16", "2026-11-09"), false);
  assert.equal(isDayInWeek("2026-11-08", "2026-11-09"), false);
});

test("no parameters at all means this week, opening on today", () => {
  const resolved = resolveScheduleQuery({}, NOW);
  assert.equal(resolved.weekStart, "2026-11-09");
  assert.equal(resolved.selectedDay, "2026-11-10");
  assert.equal(resolved.offset, 0);
  assert.equal(resolved.hasPrev, true);
  assert.equal(resolved.hasNext, true);
});

test("?week=prev and ?week=next walk exactly one week", () => {
  assert.equal(resolveScheduleQuery({ week: "prev" }, NOW).weekStart, "2026-11-02");
  assert.equal(resolveScheduleQuery({ week: "next" }, NOW).weekStart, "2026-11-16");
  assert.equal(resolveScheduleQuery({ week: "prev" }, NOW).offset, -1);
  assert.equal(resolveScheduleQuery({ week: "next" }, NOW).offset, 1);
});

test("?w= wins over ?week= and snaps to the Monday of its week", () => {
  const resolved = resolveScheduleQuery({ week: "next", w: "2026-11-04" }, NOW);
  assert.equal(resolved.weekStart, "2026-11-02", "4 November is in the week of the 2nd");
  assert.equal(resolved.offset, -1);
});

test("navigation is clamped to two weeks back and three weeks ahead", () => {
  const far = resolveScheduleQuery({ w: "2020-01-01" }, NOW);
  assert.equal(far.offset, -MAX_WEEKS_BACK);
  assert.equal(far.hasPrev, false, "no arrow past the clamp");
  assert.equal(far.weekStart, "2026-10-26");

  const future = resolveScheduleQuery({ w: "2030-01-01" }, NOW);
  assert.equal(future.offset, MAX_WEEKS_AHEAD);
  assert.equal(future.hasNext, false);
  assert.equal(future.weekStart, "2026-11-30", "three weeks after the week of the 9th");
});

test("?day= is honoured inside the week and ignored outside it", () => {
  const inside = resolveScheduleQuery({ day: "2026-11-13" }, NOW);
  assert.equal(inside.selectedDay, "2026-11-13");

  const outside = resolveScheduleQuery({ day: "2026-11-30" }, NOW);
  assert.equal(outside.selectedDay, "2026-11-10", "falls back to today");

  const withWeek = resolveScheduleQuery({ week: "next", day: "2026-11-18" }, NOW);
  assert.equal(withWeek.selectedDay, "2026-11-18");
});

test("a nonsense URL lands on this week instead of throwing", () => {
  for (const params of [{ week: "yesterday" }, { w: "not-a-day" }, { day: "2026-99-99" }, { w: "" }]) {
    const resolved = resolveScheduleQuery(params, NOW);
    assert.equal(resolved.weekStart, "2026-11-09", JSON.stringify(params));
    assert.ok(isDayInWeek(resolved.selectedDay, resolved.weekStart));
  }
});

test("an empty ?w= is ignored while a real ?week= still applies", () => {
  // A present-but-empty parameter must not wipe out a valid neighbour.
  assert.equal(resolveScheduleQuery({ week: "next", w: "", day: "" }, NOW).weekStart, "2026-11-16");
});

test("isoDayFromUnix reads UTC, not the host's zone", () => {
  assert.equal(isoDayFromUnix(Date.UTC(2026, 10, 10, 23, 59, 59) / 1000), "2026-11-10");
  assert.equal(isoDayFromUnix(Date.UTC(2026, 10, 11, 0, 0, 0) / 1000), "2026-11-11");
});
