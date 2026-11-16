"use client";
// Prompt 41 (B): the download dropdown's markup, kept in its own module (no
// portal, no asset import) so a unit test can render it and read the real link
// attributes and menu roles.

import React from "react";
import type { AdConfig } from "@/app/lib/downloads/ad";
import styles from "./component.module.css";
import { sortQualities } from "./position";

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
const AUDIO_ORDER: Array<"sub" | "dub"> = ["sub", "dub"];

function DownloadGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8 2v7m0 0 2.6-2.6M8 9 5.4 6.4" />
      <path d="M2.6 11.2v1.4a1 1 0 0 0 1 1h8.8a1 1 0 0 0 1-1v-1.4" />
    </svg>
  );
}

/** Sub first, then Dub; only the groups the API actually returned. */
export function orderedGroups(groups: DownloadGroup[]): DownloadGroup[] {
  return AUDIO_ORDER.flatMap((audio) => groups.filter((group) => group.audio === audio)).map(
    (group) => ({ ...group, options: sortQualities(group.options) }),
  );
}

export function DownloadMenu({
  episode,
  payload,
  onSelect,
  menuRef,
}: {
  episode: number;
  payload: DownloadPayload;
  onSelect: () => void;
  menuRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div className={styles.menu} role="menu" aria-label={`Download Episode ${episode}`} ref={menuRef}>
      <p className={styles.menu_title}>Download Episode {episode}</p>
      {payload.provider ? (
        <p className={styles.menu_provider}>
          Source: <strong>{payload.provider}</strong>
        </p>
      ) : null}

      {orderedGroups(payload.groups).map((group) => (
        <div key={group.audio} className={styles.menu_group}>
          <p className={styles.menu_audio}>{AUDIO_LABEL[group.audio]}</p>
          {group.options.map((option) => (
            <a
              key={`${group.audio}-${option.quality}-${option.url}`}
              className={styles.menu_item}
              role="menuitem"
              href={option.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              onClick={onSelect}
            >
              <DownloadGlyph />
              <span>{option.quality}</span>
            </a>
          ))}
        </div>
      ))}

      <p className={styles.menu_note}>Opens an external page. It may show ads.</p>
    </div>
  );
}
