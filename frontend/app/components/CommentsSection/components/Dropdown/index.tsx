"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import styles from "./component.module.css";

export type DropdownOption = {
  value: string;
  label: string;
};

type DropdownTypes = {
  /** Visible label prefix, e.g. "Sort". Shown only to screen readers when
   *  `label` is not given. */
  ariaLabel: string;
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  /** Right-aligns the menu (the control on the right of a row). */
  align?: "start" | "end";
};

/**
 * The small underlined menus under the header. A button plus a listbox: the
 * button is the only tab stop, the arrows move inside, Enter/Space selects,
 * Escape and any outside click close it.
 */
export default function Dropdown({
  ariaLabel,
  value,
  options,
  onChange,
  align = "start",
}: DropdownTypes) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const selected = options[selectedIndex];

  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [isOpen]);

  function open() {
    setActiveIndex(selectedIndex);
    setIsOpen(true);
  }

  function choose(index: number) {
    const option = options[index];
    if (option) onChange(option.value);
    setIsOpen(false);
    buttonRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!isOpen) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
      buttonRef.current?.focus();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % options.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + options.length) % options.length);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(options.length - 1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(activeIndex);
    }
  }

  return (
    <div
      className={styles.dropdown}
      data-align={align}
      ref={containerRef}
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        ref={buttonRef}
        className={styles.dropdown_button}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
        aria-label={`${ariaLabel}: ${selected?.label ?? ""}`}
        onClick={() => (isOpen ? setIsOpen(false) : open())}
        data-testid={`dropdown-${ariaLabel.toLowerCase().replace(/\s+/g, "-")}`}
      >
        <span>{selected?.label}</span>
        <span className={styles.chevron} aria-hidden="true">
          ▾
        </span>
      </button>

      {isOpen && (
        <ul className={styles.dropdown_menu} role="listbox" id={listId} aria-label={ariaLabel}>
          {options.map((option, index) => (
            <li key={option.value}>
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={styles.dropdown_option}
                data-active={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(index)}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
