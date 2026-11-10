"use client";
// Prompt 33 Part B - the whole interactive schedule.
//
// The server hands over RAW timestamps and the week window. Every day boundary,
// "today", the countdowns, the grouping and the selected day are computed here,
// in the viewer's own time zone, which is why nothing on this page can show a
// day that flips after hydration.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import styles from "../schedule.module.css";
import Clock from "./Clock";
import ZoneSwitch from "./ZoneSwitch";
import UpNextStrip from "./UpNextStrip";
import WeekBar from "./WeekBar";
import ScheduleFiltersBar from "./ScheduleFilters";
import DayTimeline from "./DayTimeline";
import { JustReleasedRow, PremieringRow } from "./PremieringRow";
import { useMounted, useNow, usePrefersReducedMotion, useStoredFlag, useStoredValue, useViewerTimeZone } from "./hooks";
import { DEFAULT_FILTERS, filterSchedule, justReleased, upNext } from "@/app/lib/schedule/format";
import type { ScheduleFilters } from "@/app/lib/schedule/format";
import { groupByLocalDay, localToday, localWeekStart, zoneLine } from "@/app/lib/schedule/local";
import { addDays, isDayInWeek } from "@/app/lib/schedule/window";
import {
  FIXED_ZONES,
  SCHEDULE_ZONES,
  type ScheduleItem,
  type ScheduleMedia,
  type ScheduleZone,
} from "@/app/lib/schedule/types";
import { useUser } from "@/app/lib/supabase/AuthProvider";
import { listFavourites } from "@/app/lib/user-data/favourites";
import { listEntries } from "@/app/lib/user-data/lists";

const ZONE_KEY = "kumori_schedule_zone";
const VIEW_KEY = "kumori_schedule_view";
const FILTERS_KEY = "kumori_schedule_filters";
const HIDE_AIRED_KEY = "kumori_schedule_hide_aired";

type Props = {
  weekStart: string;
  days: string[];
  initialDay: string;
  dayFromUrl: boolean;
  offset: number;
  hasPrev: boolean;
  hasNext: boolean;
  items: ScheduleItem[];
  premiering: ScheduleMedia[];
  ok: boolean;
  stale?: boolean;
  error?: string;
  nowUnix: number;
  siteUrl: string;
};

function readStoredFilters(): ScheduleFilters {
  try {
    const raw = window.localStorage.getItem(FILTERS_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const parsed = JSON.parse(raw) as Partial<ScheduleFilters>;
    return {
      scope: parsed.scope === "kumori" || parsed.scope === "mylist" ? parsed.scope : "all",
      formats: Array.isArray(parsed.formats) ? parsed.formats.filter((value) => typeof value === "string") : [],
      query: typeof parsed.query === "string" ? parsed.query : "",
      hideAired: parsed.hideAired === true,
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

export default function ScheduleView(props: Props) {
  const { items, premiering, weekStart, days, hasPrev, hasNext, offset } = props;
  const router = useRouter();
  const pathname = usePathname();
  const mounted = useMounted();
  const now = useNow(props.nowUnix);
  const viewerZone = useViewerTimeZone();
  const reducedMotion = usePrefersReducedMotion();
  const [zone, setZone] = useStoredValue<ScheduleZone>(ZONE_KEY, "local", SCHEDULE_ZONES);
  const [view, setView] = useStoredValue<"list" | "grid">(VIEW_KEY, "list", ["list", "grid"] as const);
  const [density, setDensity] = useState<"list" | "grid">("list");
  const [filters, setFilters] = useState<ScheduleFilters>(DEFAULT_FILTERS);
  const [selectedDay, setSelectedDay] = useState(props.initialDay);
  const [myListIds, setMyListIds] = useState<Set<number>>(new Set());
  const [hideAired, setHideAired] = useStoredFlag(HIDE_AIRED_KEY, false);
  const shellRef = useRef<HTMLDivElement>(null);
  const { user } = useUser();

  const timeZone = zone === "local" ? viewerZone : FIXED_ZONES[zone];

  // The sticky week bar sits under the real header, whatever its height is.
  useEffect(() => {
    if (!mounted) return;
    const measure = () => {
      const header = document.getElementById("background");
      const height = header?.getBoundingClientRect().height;
      if (height) shellRef.current?.style.setProperty("--schedule-sticky-top", `${Math.round(height)}px`);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [mounted]);

  // Remembered preferences, read once after mount (storage can throw).
  useEffect(() => {
    if (!mounted) return;
    setFilters(readStoredFilters());
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;
    setDensity(view === "grid" ? "grid" : "list");
  }, [mounted, view]);

  useEffect(() => {
    if (!mounted) return;
    try {
      window.localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
    } catch {
      /* ignore a blocked store */
    }
  }, [filters, mounted]);

  // Signed-in viewers get their favourites and watchlist marked, in two reads.
  useEffect(() => {
    if (!mounted || !user) {
      setMyListIds(new Set());
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const [favourites, entries] = await Promise.all([listFavourites(), listEntries()]);
        if (!alive) return;
        const ids = new Set<number>();
        for (const favourite of favourites) ids.add(Number(favourite.id));
        for (const entry of entries) ids.add(Number(entry.id));
        setMyListIds(ids);
      } catch {
        if (alive) setMyListIds(new Set());
      }
    })();
    return () => {
      alive = false;
    };
  }, [mounted, user]);

  const today = localToday(now, timeZone);

  // The pills are the viewer's LOCAL week. When the server's UTC week is a
  // different week (a Sunday-night viewer east of UTC), ask it for the right one.
  useEffect(() => {
    if (!mounted || zone !== "local") return;
    const targetStart = addDays(localWeekStart(now, timeZone), offset * 7);
    if (targetStart === weekStart) return;
    const params = new URLSearchParams({ w: targetStart, day: localToday(now, timeZone) });
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [mounted, now, timeZone, zone, offset, weekStart, pathname, router]);

  // Open on today unless the URL pinned a day.
  useEffect(() => {
    if (!mounted) return;
    if (props.dayFromUrl && isDayInWeek(props.initialDay, weekStart)) {
      setSelectedDay(props.initialDay);
      return;
    }
    setSelectedDay(isDayInWeek(today, weekStart) ? today : weekStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, today, weekStart]);

  const selectDay = useCallback(
    (day: string) => {
      setSelectedDay(day);
      if (!mounted) return;
      const params = new URLSearchParams({ w: weekStart, day });
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [mounted, pathname, router, weekStart],
  );

  const goWeek = useCallback(
    (delta: number) => {
      const params = new URLSearchParams({ w: addDays(weekStart, delta * 7) });
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, weekStart],
  );

  const goToday = useCallback(() => {
    const params = new URLSearchParams({ w: localWeekStart(now, timeZone), day: localToday(now, timeZone) });
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }, [now, pathname, router, timeZone]);

  const grouped = useMemo(() => groupByLocalDay(items, timeZone, (item) => item.airingAt, days), [items, timeZone, days]);

  const counts = useMemo(() => {
    const result: Record<string, number> = {};
    for (const day of days) result[day] = 0;
    for (const group of grouped) {
      if (group.day in result) result[group.day] = group.items.length;
    }
    return result;
  }, [grouped, days]);

  const dayItemsAll = useMemo(() => grouped.find((group) => group.day === selectedDay)?.items ?? [], [grouped, selectedDay]);

  const effectiveFilters = useMemo<ScheduleFilters>(
    () => ({ ...filters, hideAired: filters.hideAired && hideAired }),
    [filters, hideAired],
  );

  const dayItems = useMemo(
    () =>
      filterSchedule(dayItemsAll, effectiveFilters, {
        nowUnixSeconds: now,
        myListIds,
        onlyToday: selectedDay === today,
      }),
    [dayItemsAll, effectiveFilters, now, myListIds, selectedDay, today],
  );

  const next = useMemo(() => upNext(items, now, 6), [items, now]);
  const released = useMemo(() => justReleased(items, now, 8), [items, now]);

  const nextDayWithReleases = useMemo(() => {
    for (let cursor = days.indexOf(selectedDay) + 1; cursor < days.length; cursor += 1) {
      const count = counts[days[cursor]] ?? 0;
      if (count > 0) return { day: days[cursor], count };
    }
    return null;
  }, [counts, days, selectedDay]);

  const updateFilters = useCallback(
    (patch: Partial<ScheduleFilters>) => {
      if (typeof patch.hideAired === "boolean") setHideAired(patch.hideAired);
      setFilters((current) => ({ ...current, ...patch }));
    },
    [setHideAired],
  );

  const changeView = useCallback(
    (nextView: "list" | "grid") => {
      setDensity(nextView);
      setView(nextView);
    },
    [setView],
  );

  const icsHref =
    myListIds.size > 0 ? `/api/schedule/ics?ids=${[...myListIds].slice(0, 50).join(",")}&days=14` : null;

  if (!props.ok) {
    return (
      <div className={styles.shell} ref={shellRef} data-motion={reducedMotion ? "reduced" : "full"}>
        <div className={styles.error_box} role="alert" data-testid="schedule-error">
          <h2 className={styles.section_title}>The release schedule is unavailable right now</h2>
          <p className={styles.muted}>
            AniList did not answer. Nothing is lost: try again, or browse the catalogue in the meantime.
          </p>
          <button type="button" className={styles.action} data-primary="true" onClick={() => router.refresh()}>
            Try again
          </button>
        </div>
        <PremieringRow items={premiering} />
      </div>
    );
  }

  return (
    <div className={styles.shell} ref={shellRef} data-motion={reducedMotion ? "reduced" : "full"}>
      <header className={styles.header_block}>
        <h1 className={styles.title}>Anime Release Schedule</h1>
        <p className={styles.subtitle}>
          Every episode airing this week, in your own time zone, with live countdowns and a direct link to watch.
        </p>
        <div className={styles.meta_row}>
          <span className={styles.zone_line}>
            Times shown in your time zone:{" "}
            <span className={styles.zone_value} data-testid="zone-line">
              {mounted ? zoneLine(timeZone, now) : "your time zone"}
            </span>
          </span>
          <ZoneSwitch value={zone} onChange={setZone} />
          <Clock now={now} timeZone={timeZone} mounted={mounted} />
        </div>
        {props.stale ? <p className={styles.muted}>Showing the last schedule we fetched.</p> : null}
      </header>

      <UpNextStrip items={next} timeZone={timeZone} now={now} mounted={mounted} />

      <WeekBar
        days={days}
        counts={counts}
        selectedDay={selectedDay}
        today={today}
        hasPrev={hasPrev}
        hasNext={hasNext}
        onSelect={selectDay}
        onPrevWeek={() => goWeek(-1)}
        onNextWeek={() => goWeek(1)}
        onToday={goToday}
      />

      <ScheduleFiltersBar
        filters={{ ...filters, hideAired }}
        onChange={updateFilters}
        view={density}
        onViewChange={changeView}
        isToday={selectedDay === today}
        signedIn={!!user}
      />

      <DayTimeline
        items={dayItems}
        day={selectedDay}
        now={now}
        timeZone={timeZone}
        mounted={mounted}
        siteUrl={props.siteUrl}
        showJst={zone !== "jst"}
        signedIn={!!user}
        view={density}
        nextDayWithReleases={nextDayWithReleases}
        onPickDay={selectDay}
        emptyReason={dayItemsAll.length ? "filtered" : "none"}
      />

      <JustReleasedRow items={released} timeZone={timeZone} mounted={mounted} />
      <PremieringRow items={premiering} />

      {user && icsHref ? (
        <p className={styles.section_hint} style={{ marginTop: 24 }}>
          <a className={styles.action} href={icsHref}>
            Subscribe to calendar
          </a>
        </p>
      ) : null}
    </div>
  );
}
