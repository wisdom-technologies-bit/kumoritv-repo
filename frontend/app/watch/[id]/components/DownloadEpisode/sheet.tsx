"use client";
// The sheet's markup, kept in its own module: no portal, no SDK hook, no asset
// import, so a unit test can render it and read the real link attributes.

import React from "react";
import type { AdConfig } from "@/app/lib/downloads/ad";
import styles from "./component.module.css";

export type DownloadOption = { quality: string; url: string };
export type DownloadGroup = { audio: "sub" | "dub"; options: DownloadOption[] };
export type DownloadPayload = {
  available: boolean;
  provider: string | null;
  groups: DownloadGroup[];
  note: string | null;
  disabled?: boolean;
  ad?: AdConfig | null;
};

const AUDIO_LABEL: Record<"sub" | "dub", string> = { sub: "Sub", dub: "Dub" };

/** The sheet content, separate from the portal so it can be rendered in a test. */
export function DownloadSheet({
  title,
  payload,
  audio,
  onAudio,
  onSelect,
  onClose,
  panelRef,
}: {
  title: string;
  payload: DownloadPayload;
  audio: "sub" | "dub";
  onAudio: (next: "sub" | "dub") => void;
  onSelect: () => void;
  onClose: () => void;
  panelRef?: React.Ref<HTMLDivElement>;
}) {
  const active =
    payload.groups.find((group) => group.audio === audio) || payload.groups[0];

  return (
    <div className={styles.overlay} role="presentation" onMouseDown={onClose}>
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="download-sheet-title"
        ref={panelRef}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <h2 id="download-sheet-title">{title}</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        {payload.provider ? (
          <p className={styles.provider}>
            Source: <strong>{payload.provider}</strong>
          </p>
        ) : null}

        {payload.groups.length > 1 ? (
          <div className={styles.tabs} role="tablist" aria-label="Audio">
            {payload.groups.map((group) => (
              <button
                key={group.audio}
                type="button"
                role="tab"
                aria-selected={group.audio === active?.audio}
                className={styles.tab}
                data-active={group.audio === active?.audio ? "true" : undefined}
                onClick={() => onAudio(group.audio)}
              >
                {AUDIO_LABEL[group.audio]}
              </button>
            ))}
          </div>
        ) : null}

        <div className={styles.qualities}>
          {(active?.options || []).map((option) => (
            <a
              key={`${option.quality}-${option.url}`}
              className={styles.quality}
              href={option.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              onClick={onSelect}
            >
              {option.quality}
              <span className={styles.quality_hint}>Download</span>
            </a>
          ))}
        </div>

        <p className={styles.note}>
          Opens an external download page in a new tab. That site may show ads.
        </p>
        {payload.ad?.url ? (
          <p className={styles.sponsor}>Support KumoriTV: a sponsor page may open</p>
        ) : null}
      </div>
    </div>
  );
}
