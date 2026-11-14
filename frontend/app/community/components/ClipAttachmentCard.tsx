"use client";
// Prompt 38F: the clip that is attached to the post being written.
//
// The same card the picker shows, plus a Remove button, because the attachment
// belongs to the composer from the moment it is picked or pasted.
//
// THE ADULT RULE: when the server masked the clip (adult, setting off) this
// renders the label and one sentence and nothing else - no thumbnail, no anime
// title, no range, no link. There is nothing else to render: the masked shape
// has no other fields.

import Image from "next/image";
import { useState } from "react";
import styles from "../page.module.css";
import {
  ADULT_HIDDEN_TEXT,
  ADULT_LABEL,
  clipDurationLabel,
  clipMetaLabel,
  clipRangeLabel,
  clipThumbPath,
  type AttachedClip,
} from "@/app/lib/community/clip-attachment";

export default function ClipAttachmentCard({
  clip,
  onRemove,
  isRemoving = false,
}: {
  clip: AttachedClip;
  onRemove?: () => void;
  isRemoving?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const thumb = clipThumbPath(clip.anilistId, clip.episode);
  const range = clipRangeLabel(clip.start, clip.end);
  const duration = clipDurationLabel(clip.start, clip.end);

  return (
    <div className={styles.attach_row} data-clip-attachment="true">
      {clip.hidden ? (
        <div className={styles.adult_card} data-adult-hidden="true">
          <span className={styles.adult_label}>{ADULT_LABEL}</span>
          <p className={styles.adult_text}>{ADULT_HIDDEN_TEXT}</p>
        </div>
      ) : (
        <div className={styles.attach_card}>
          {thumb && !broken ? (
            <span className={styles.attach_thumb}>
              <Image
                src={thumb}
                alt=""
                width={112}
                height={63}
                sizes="112px"
                onError={() => setBroken(true)}
                unoptimized
              />
            </span>
          ) : (
            <span className={styles.attach_thumb} aria-hidden="true" data-placeholder="true" />
          )}
          <div className={styles.attach_text}>
            <span className={styles.attach_title}>
              {clip.title || clipMetaLabel(clip.animeTitle, clip.episode) || `Clip ${clip.code}`}
            </span>
            <span className={styles.attach_meta}>
              {[clipMetaLabel(clip.animeTitle, clip.episode), range, duration].filter(Boolean).join(" · ")}
            </span>
          </div>
        </div>
      )}

      {onRemove && (
        <button
          type="button"
          className={styles.button_link}
          onClick={onRemove}
          disabled={isRemoving}
          aria-label="Remove the attached clip"
        >
          Remove
        </button>
      )}
    </div>
  );
}
