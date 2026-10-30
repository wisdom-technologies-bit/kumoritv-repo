// Legacy episode-source list from the original fork.
//
// The "Main Source of Episodes" setting is no longer surfaced in the UI: the
// audit found the stored value (profiles.preferred_audio) is never read as a
// source name anywhere in the app, and writing it there clobbered the sub/dub
// preference. Nothing imports this module any more; the data is kept so the
// historical values stay documented.

import { SourceType } from "@/app/ts/interfaces/episodesSource";

export const sourcesAvailable: {
  name: string;
  value: SourceType["source"];
  isAvailable: boolean;
  apiOrigin: "consumet" | "aniwatch" | "anilist";
}[] = [
  {
    name: "Crunchyroll",
    value: "crunchyroll",
    isAvailable: false, // initiates as false
    apiOrigin: "anilist",
  },
  {
    name: "GoGoAnime",
    value: "gogoanime",
    isAvailable: false,
    apiOrigin: "consumet",
  },
  {
    name: "Zoro",
    value: "zoro",
    isAvailable: false,
    apiOrigin: "consumet",
  },
  {
    name: "Aniwatch",
    value: "aniwatch",
    isAvailable: false,
    apiOrigin: "aniwatch",
  },
];
