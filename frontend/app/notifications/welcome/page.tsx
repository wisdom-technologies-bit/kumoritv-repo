import type { Metadata } from "next";
import Link from "next/link";
import styles from "./component.module.css";

// Target of OneSignal's welcome notification. Information only: it never asks for
// permission and never touches the SDK, so it is safe to open from a push.
export const metadata: Metadata = {
  title: "Notifications are on",
  description:
    "Push notifications are on. You will get a notification when anime you subscribed to has a new episode, and when KumoriTV posts an announcement.",
  alternates: { canonical: "/notifications/welcome" },
  robots: { index: false, follow: false },
};

export default function NotificationsWelcomePage() {
  return (
    <main id={styles.container}>
      <section id={styles.card}>
        <h1 id={styles.title}>Push notifications are on</h1>

        <p id={styles.summary}>
          You will get a notification when anime you subscribed to has a new episode, and when
          KumoriTV posts an announcement. You can change this any time.
        </p>

        <div id={styles.actions}>
          <Link id={styles.primary_action} href="/?settings=notifications">
            Choose what I get notified about
          </Link>

          <Link id={styles.secondary_action} href="/">
            Browse anime
          </Link>
        </div>
      </section>
    </main>
  );
}
