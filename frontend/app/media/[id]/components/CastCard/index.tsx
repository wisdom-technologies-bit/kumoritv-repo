"use client";
// One cast card. The front is the character; for an anime with a voice actor the
// card flips (tap, click, Enter/Space, or hover on a device that can hover) to the
// actor. Everything else stays a plain, non-interactive list item.
//
// The markup of the `<li>` is unchanged from the server-rendered version, so the
// existing page CSS and tests keep working; only the flip state is new.

import React, { useRef, useState } from "react";
import Image from "next/image";
import styles from "../../page.module.css";

export type CastMember = {
  characterName: string;
  characterImage: string;
  voiceActorName?: string | null;
  voiceActorImage?: string | null;
};

/** A drag on the horizontal scroller is not a tap. */
const SWIPE_TOLERANCE_PX = 8;

export function CastCard({
  mediaType,
  member,
  flipped,
  onToggle,
}: {
  mediaType: string;
  member: CastMember;
  flipped: boolean;
  onToggle: () => void;
}) {
  const pressOrigin = useRef<{ x: number; y: number } | null>(null);

  const hasVoiceActor =
    mediaType === "ANIME" && !!member.voiceActorName && !!member.voiceActorImage;

  function handlePointerDown(event: React.PointerEvent<HTMLLIElement>) {
    pressOrigin.current = { x: event.clientX, y: event.clientY };
  }

  function handleClick(event: React.MouseEvent<HTMLLIElement>) {
    const origin = pressOrigin.current;
    pressOrigin.current = null;

    if (
      origin &&
      (Math.abs(event.clientX - origin.x) > SWIPE_TOLERANCE_PX ||
        Math.abs(event.clientY - origin.y) > SWIPE_TOLERANCE_PX)
    ) {
      return;
    }

    onToggle();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLLIElement>) {
    if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") return;

    // Space would otherwise scroll the page.
    event.preventDefault();
    onToggle();
  }

  const interactive: React.HTMLAttributes<HTMLLIElement> = hasVoiceActor
    ? {
        role: "button",
        tabIndex: 0,
        "aria-pressed": flipped,
        "aria-label": flipped
          ? `Show character ${member.characterName}`
          : `Show voice actor for ${member.characterName}`,
        onClick: handleClick,
        onKeyDown: handleKeyDown,
        onPointerDown: handlePointerDown,
      }
    : {};

  return (
    <li
      data-mediatype={mediaType}
      data-interactive={hasVoiceActor ? "true" : undefined}
      data-flipped={flipped ? "true" : undefined}
      {...interactive}
    >
      <div className={styles.character_container}>
        <div className={styles.img_container}>
          <Image src={member.characterImage} alt={member.characterName} fill sizes="72px" />
        </div>

        <h3>{member.characterName}</h3>
      </div>

      {/* SHOWS ACTOR ONLY FOR ANIMES WITH A VOICE ACTOR */}
      {hasVoiceActor && (
        <div className={styles.actor_container}>
          <div className={styles.img_container}>
            <Image
              src={member.voiceActorImage!}
              alt={`${member.voiceActorName} voiceover for ${member.characterName}`}
              fill
              sizes="72px"
            />
          </div>

          <h3>{member.voiceActorName}</h3>
        </div>
      )}
    </li>
  );
}

/** The cast scroller. Holds the flip state so only one card is flipped at a time. */
export default function CastRow({
  mediaType,
  members,
}: {
  mediaType: string;
  members: CastMember[];
}) {
  const [flippedIndex, setFlippedIndex] = useState<number | null>(null);

  return (
    <ul className="display_flex_row">
      {members.map((member, index) => (
        <CastCard
          key={index}
          mediaType={mediaType}
          member={member}
          flipped={flippedIndex === index}
          onToggle={() => setFlippedIndex(flippedIndex === index ? null : index)}
        />
      ))}
    </ul>
  );
}
