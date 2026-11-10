// Same boxes as the real page, so nothing moves when the data lands.
import styles from "./schedule.module.css";

export default function ScheduleLoading() {
  return (
    <main className={styles.page} aria-busy="true" aria-label="Loading the release schedule">
      <div className={styles.shell}>
        <div className={styles.header_block}>
          <h1 className={styles.title}>Anime Release Schedule</h1>
          <p className={styles.subtitle}>Every episode airing this week, in your own time zone.</p>
        </div>

        <section className={styles.section} aria-hidden="true">
          <div className={styles.section_head}>
            <h2 className={styles.section_title}>Up next</h2>
          </div>
          <div className={styles.upnext_scroller}>
            {Array.from({ length: 6 }, (_, index) => (
              <div className={styles.upnext_card} key={index}>
                <div className={`${styles.skeleton} ${styles.skeleton_poster}`} style={{ width: "100%" }} />
                <div className={styles.upnext_meta}>
                  <span className={`${styles.skeleton}`} style={{ height: 12, width: "90%" }} />
                  <span className={`${styles.skeleton}`} style={{ height: 12, width: "60%" }} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className={styles.week_bar} aria-hidden="true">
          <div className={styles.days_scroller}>
            {Array.from({ length: 7 }, (_, index) => (
              <div className={`${styles.skeleton} ${styles.skeleton_pill}`} key={index} />
            ))}
          </div>
        </div>

        <div className={styles.timeline} aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => (
            <div className={`${styles.skeleton} ${styles.skeleton_card}`} key={index} />
          ))}
        </div>
      </div>
    </main>
  );
}
