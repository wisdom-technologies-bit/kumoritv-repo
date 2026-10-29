import React from "react";
import Link from "next/link";
import styles from "./component.module.css";
import {
  LEGAL_BRAND,
  LEGAL_CONTACT_EMAIL,
  LEGAL_LAST_UPDATED,
  LEGAL_LAST_UPDATED_ISO,
} from "@/app/lib/legal/content";

export type LegalSection = {
  /** Anchor id, also used by the table of contents. */
  id: string;
  heading: string;
  /** Paragraphs and lists, in reading order. */
  body: React.ReactNode;
};

type LegalPageProps = {
  kind: "Privacy Policy" | "Terms of Service";
  title: string;
  summary: string;
  sections: LegalSection[];
  /** Shown above the contact block, e.g. what to include in a request. */
  contactNote?: React.ReactNode;
};

function slugToLabel(sections: LegalSection[]) {
  return sections.map((section, index) => ({
    id: section.id,
    label: `${index + 1}. ${section.heading}`,
  }));
}

export default function LegalPage({
  kind,
  title,
  summary,
  sections,
  contactNote,
}: LegalPageProps) {
  const toc = slugToLabel(sections);

  return (
    <main id={styles.container}>
      <header id={styles.header}>
        <p id={styles.eyebrow}>{kind}</p>
        <h1>{title}</h1>
        <p id={styles.summary}>{summary}</p>
        <p id={styles.updated}>
          <span>
            Last updated{" "}
            <time dateTime={LEGAL_LAST_UPDATED_ISO}>{LEGAL_LAST_UPDATED}</time>
          </span>
          <span aria-hidden="true" id={styles.dot}>
            •
          </span>
          <span>Applies to {LEGAL_BRAND} and every page under it</span>
        </p>
      </header>

      <div id={styles.body_grid}>
        <nav id={styles.toc} aria-label={`${kind} contents`}>
          <p id={styles.toc_heading}>On this page</p>
          <ol>
            {toc.map((item) => (
              <li key={item.id}>
                <a href={`#${item.id}`}>{item.label}</a>
              </li>
            ))}
          </ol>
        </nav>

        <article id={styles.article}>
          {sections.map((section, index) => (
            <section key={section.id} id={section.id}>
              <h2>
                <span aria-hidden="true">{index + 1}. </span>
                {section.heading}
              </h2>
              {section.body}
            </section>
          ))}

          <section id="contact" className={styles.contact_block}>
            <h2>
              <span aria-hidden="true">{sections.length + 1}. </span>
              Contact us
            </h2>
            {contactNote}
            <p>
              Email{" "}
              <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>
              . We answer privacy and legal requests within 30 days.
            </p>
            <p>
              You can also reach the team on the{" "}
              <a
                href="https://discord.gg/J8CjhJWrnu"
                target="_blank"
                rel="noopener noreferrer"
              >
                {LEGAL_BRAND} Discord server
              </a>
              .
            </p>
          </section>

          <footer id={styles.footer_note}>
            <p>
              Read this together with our{" "}
              <Link href="/privacy">Privacy Policy</Link>{" "}
              and our{" "}
              <Link href="/terms">Terms of Service</Link>.
            </p>
          </footer>
        </article>
      </div>
    </main>
  );
}
