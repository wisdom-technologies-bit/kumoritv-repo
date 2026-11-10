"use client";
// A thrown error still renders a page with a way out, never a blank screen.
import { useEffect } from "react";
import styles from "./schedule.module.css";

export default function ScheduleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Keep the console useful without dumping the whole stack into the UI.
    console.error("schedule page error", error?.message);
  }, [error]);

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.error_box} role="alert">
          <h1 className={styles.section_title}>The release schedule could not be loaded</h1>
          <p className={styles.muted}>
            Something went wrong while building this week. Trying again usually fixes it.
          </p>
          <button type="button" className={styles.action} data-primary="true" onClick={reset}>
            Try again
          </button>
        </div>
      </div>
    </main>
  );
}
