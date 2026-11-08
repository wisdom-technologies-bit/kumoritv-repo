import React from "react";
import styles from "./footerComponent.module.css";
import Link from "next/link";
import FooterHeading from "./components/footerHeading";
import NavLinks from "./components/navLinks";
import { LEGAL_LINKS } from "@/app/lib/legal/content";

function Footer() {
  const currYear = new Date().getFullYear();

  return (
    <footer id={styles.footer}>
      <section id={styles.info_container}>
        <FooterHeading />

        <span id={styles.span_border1}></span>

        <NavLinks />
      </section>

      <section id={styles.copyright_section}>
        <div id={styles.copyright_row}>
          <p className={styles.copyright_text}>
            Copyright © {currYear}, KumoriTV. All Rights Reserved.
          </p>

          <nav className={styles.legal_links} aria-label="Legal">
            {LEGAL_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className={styles.legal_link}>
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <p className={styles.disclaimer}>
          <strong>Disclaimer:</strong> KumoriTV does not store any files on its
          server. All contents are provided by non-affiliated third parties, and
          KumoriTV is not responsible for their availability, quality or legality.
        </p>

        <p className={styles.tmdb_credit}>
          This product uses the TMDB API but is not endorsed or certified by
          TMDB.{" "}
          <a
            href="https://www.themoviedb.org"
            target="_blank"
            rel="noreferrer noopener"
          >
            themoviedb.org
          </a>
        </p>
      </section>
    </footer>
  );
}

export default Footer;
