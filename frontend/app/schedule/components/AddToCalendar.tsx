"use client";
// "Add to calendar": the .ics is generated in the browser from the one episode
// the card is about, with a 15 minute reminder. No round trip, no stored file.
import styles from "../schedule.module.css";
import { buildIcs } from "@/app/lib/schedule/ics";
import { scheduleTitle } from "@/app/lib/schedule/format";
import type { ScheduleItem } from "@/app/lib/schedule/types";

function download(filename: string, contents: string) {
  const blob = new Blob([contents], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a tick to start the download before revoking.
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export default function AddToCalendar({ item, siteUrl }: { item: ScheduleItem; siteUrl: string }) {
  function handleClick() {
    try {
      const ics = buildIcs({
        items: [item],
        siteUrl,
        nowUnixSeconds: Math.floor(Date.now() / 1000),
        calendarName: "KumoriTV",
        days: 365,
      });
      const slug = scheduleTitle(item.media).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
      download(`kumori-${slug || item.media.id}-ep${item.episode}.ics`, ics);
    } catch {
      /* a blocked download must not break the page */
    }
  }

  return (
    <button type="button" className={styles.action} onClick={handleClick}>
      Add to calendar
    </button>
  );
}
