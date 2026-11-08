"use client";

// Prompt 30: the watch page shell.
//
// It owns the two view modes that are pure UI and nothing else:
//   - "Theater": the player takes the whole content width and the episodes
//     panel drops below it. Remembered in localStorage (best effort).
//   - "Lights off": a fixed black scrim over the page, with the player kept
//     above it so its own controls still work. Esc or a click closes it, and it
//     is never persisted.
//
// The grid element itself lives here (not in page.tsx) only because `data-*`
// has to change with the state. Everything inside it - the player, the
// controls, the episode list - is still server-rendered and passed as children,
// so no data fetching or player logic moved into the client.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import styles from "../../page.module.css";

export const THEATER_STORAGE_KEY = "kumori:theater";

type WatchUI = {
  theater: boolean;
  lightsOff: boolean;
  toggleTheater: () => void;
  toggleLights: () => void;
};

const Context = createContext<WatchUI | null>(null);

/** Null outside a WatchLayout (e.g. a component rendered on its own in a test). */
export function useWatchUI(): WatchUI | null {
  return useContext(Context);
}

export default function WatchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [theater, setTheater] = useState(false);
  const [lightsOff, setLightsOff] = useState(false);

  // Read after mount: the server has no localStorage, so the first paint is
  // always the standard (non-theater) layout and never hydrates mismatched.
  useEffect(() => {
    try {
      if (window.localStorage.getItem(THEATER_STORAGE_KEY) === "true")
        setTheater(true);
    } catch {
      /* private mode / blocked storage: keep the default layout */
    }
  }, []);

  const toggleTheater = useCallback(() => {
    setTheater((value) => {
      const next = !value;
      try {
        window.localStorage.setItem(THEATER_STORAGE_KEY, String(next));
      } catch {
        /* the layout still toggles, it just is not remembered */
      }
      return next;
    });
  }, []);

  const toggleLights = useCallback(() => setLightsOff((value) => !value), []);

  useEffect(() => {
    if (!lightsOff) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLightsOff(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lightsOff]);

  return (
    <Context.Provider value={{ theater, lightsOff, toggleTheater, toggleLights }}>
      <div
        id={styles.media_info_container}
        data-theater={theater ? "true" : undefined}
        data-lights-off={lightsOff ? "true" : undefined}
      >
        {children}
      </div>

      {lightsOff ? (
        <div
          className={styles.lights_overlay}
          data-testid="lights-off-overlay"
          aria-hidden="true"
          onClick={() => setLightsOff(false)}
        />
      ) : null}
    </Context.Provider>
  );
}
