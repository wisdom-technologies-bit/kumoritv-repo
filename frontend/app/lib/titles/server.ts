import { cookies } from "next/headers";
import { TITLE_LANGUAGE_COOKIE, coerceTitleLanguage, type TitleLanguage } from "./language";

/**
 * The preference a server component should render strings with (metadata, share
 * text, aria labels). Visible titles use <AnimeTitle>, which does not need this.
 */
export function getTitlePreference(): TitleLanguage {
  try {
    return coerceTitleLanguage(cookies().get(TITLE_LANGUAGE_COOKIE)?.value);
  } catch {
    return coerceTitleLanguage(undefined);
  }
}
