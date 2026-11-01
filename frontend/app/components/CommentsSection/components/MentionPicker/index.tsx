"use client";
// The @-mention dropdown over the comment composer.
//
// `useMentionPicker` owns the token detection, the 200 ms debounce and the
// keyboard map; `MentionPicker` is the list itself. Both are used by
// WriteCommentForm and by the tests.

import React, { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import styles from "./component.module.css";
import {
  MENTION_PICKER_LIMIT,
  activeMentionQuery,
  insertMention,
  type MentionQuery,
} from "@/app/lib/comments/mentions";

export type MentionUser = { username: string; avatar_url: string | null };

/** How long the picker waits after a keystroke before asking for matches. */
export const MENTION_DEBOUNCE_MS = 200;

export async function fetchMentionUsers(query: string): Promise<MentionUser[]> {
  try {
    const response = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) return [];

    const data = (await response.json()) as { users?: unknown };
    if (!Array.isArray(data.users)) return [];

    return data.users
      .filter(
        (row): row is MentionUser =>
          !!row &&
          typeof row === "object" &&
          typeof (row as MentionUser).username === "string" &&
          (row as MentionUser).username.trim().length > 0,
      )
      .slice(0, MENTION_PICKER_LIMIT)
      .map((row) => ({ username: row.username, avatar_url: row.avatar_url ?? null }));
  } catch {
    return [];
  }
}

type UseMentionPickerOptions = {
  /** The textarea's current value. */
  text: string;
  /** The textarea's caret, reported by the composer on every change and key-up. */
  caret: number;
  /** Apply a picked handle: the composer writes the new text and moves the caret. */
  onInsert: (value: { text: string; caret: number }) => void;
  /** Injectable for tests; defaults to the real endpoint. */
  fetcher?: (query: string) => Promise<MentionUser[]>;
};

export function useMentionPicker({ text, caret, onInsert, fetcher }: UseMentionPickerOptions) {
  const [query, setQuery] = useState<MentionQuery | null>(null);
  const [results, setResults] = useState<MentionUser[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestId = useRef(0);
  const search = fetcher ?? fetchMentionUsers;

  const close = useCallback(() => {
    setQuery(null);
    setResults([]);
    setActiveIndex(0);
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  // Follow the caret: an "@" at the start of a word opens the picker, and the
  // list narrows as the handle is typed.
  useEffect(() => {
    const active = activeMentionQuery(text, caret);
    setQuery(active);

    if (!active) {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      setResults([]);
      setActiveIndex(0);
      return;
    }

    if (timer.current) clearTimeout(timer.current);
    setActiveIndex(0);

    timer.current = setTimeout(() => {
      const id = requestId.current + 1;
      requestId.current = id;

      void search(active.query).then((users) => {
        // A stale response (the user kept typing) is dropped.
        if (requestId.current !== id) return;
        setResults(users.slice(0, MENTION_PICKER_LIMIT));
      });
    }, MENTION_DEBOUNCE_MS);

    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
    // `search` is stable enough (an injected fetcher or the module default).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, caret]);

  const choose = useCallback(
    (user: MentionUser) => {
      if (!query) return;
      onInsert(insertMention(text, query, user.username));
      close();
    },
    [close, onInsert, query, text],
  );

  /**
   * Keyboard map for the textarea. Returns true when the key was consumed, so
   * the composer can skip its own handling (Escape must close the list before
   * it cancels the comment).
   */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!query) return false;

      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return true;
      }

      if (event.key === " ") {
        // A space ends the handle.
        close();
        return false;
      }

      if (!results.length) return false;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % results.length);
        return true;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((index) => (index - 1 + results.length) % results.length);
        return true;
      }

      if (event.key === "Enter" || event.key === "Tab") {
        const user = results[activeIndex];
        if (!user) return false;
        event.preventDefault();
        choose(user);
        return true;
      }

      return false;
    },
    [activeIndex, choose, close, query, results],
  );

  return {
    isOpen: Boolean(query) && results.length > 0,
    query: query?.query ?? "",
    results,
    activeIndex,
    setActiveIndex,
    handleKeyDown,
    select: choose,
    close,
  };
}

export default function MentionPicker({
  results,
  activeIndex,
  onSelect,
  onHover,
}: {
  results: MentionUser[];
  activeIndex: number;
  onSelect: (user: MentionUser) => void;
  onHover?: (index: number) => void;
}) {
  if (!results.length) return null;

  return (
    <div className={styles.picker} role="listbox" aria-label="Mention someone" data-testid="mention-picker">
      {results.map((user, index) => (
        <button
          key={user.username}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          className={styles.picker_row}
          data-active={index === activeIndex ? "true" : "false"}
          // Keeps the caret in the textarea while tapping a row on a phone.
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => onHover?.(index)}
          onClick={() => onSelect(user)}
        >
          <span className={styles.picker_avatar} aria-hidden="true">
            {user.avatar_url ? (
              <Image src={user.avatar_url} alt="" fill sizes="28px" className={styles.picker_avatar_img} />
            ) : (
              <span className={styles.picker_avatar_initial}>{user.username[0]?.toUpperCase() ?? "?"}</span>
            )}
          </span>
          <span className={styles.picker_name}>@{user.username}</span>
        </button>
      ))}
    </div>
  );
}
