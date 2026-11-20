"use client";
// The preference for client components that need a STRING (aria-label, alt text,
// share text, toast copy). The visible title is handled by <AnimeTitle> and CSS,
// so this reads the same `data-title-lang` attribute the inline script sets.

import { useEffect, useState } from "react";
import { DEFAULT_TITLE_LANGUAGE, TITLE_LANGUAGE_COOKIE, normaliseTitleLanguage, type TitleLanguage } from "./language";

export const TITLE_LANGUAGE_EVENT = "kumori:title-language";

export function readDocumentTitleLanguage(): TitleLanguage {
  if (typeof document === "undefined") return DEFAULT_TITLE_LANGUAGE;

  return normaliseTitleLanguage(document.documentElement.dataset.titleLang) ?? DEFAULT_TITLE_LANGUAGE;
}

/** Keeps a client component in step with the settings modal and other tabs. */
export function useTitlePreference(): TitleLanguage {
  const [preference, setPreference] = useState<TitleLanguage>(DEFAULT_TITLE_LANGUAGE);

  useEffect(() => {
    setPreference(readDocumentTitleLanguage());

    const sync = () => setPreference(readDocumentTitleLanguage());

    window.addEventListener(TITLE_LANGUAGE_EVENT, sync);
    window.addEventListener("storage", sync);

    return () => {
      window.removeEventListener(TITLE_LANGUAGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return preference;
}

/** Sets the attribute and mirrors the value where the server can read it. */
export function applyTitleLanguage(preference: TitleLanguage) {
  try {
    document.documentElement.dataset.titleLang = preference;
    document.cookie = `${TITLE_LANGUAGE_COOKIE}=${preference}; path=/; max-age=31536000; samesite=lax`;
    window.localStorage.setItem(TITLE_LANGUAGE_COOKIE, preference);
    window.dispatchEvent(new Event(TITLE_LANGUAGE_EVENT));
  } catch {
    /* no DOM: nothing to update */
  }
}
