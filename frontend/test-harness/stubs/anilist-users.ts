// Test double for `@/app/api/anilist/anilistUsers`: the real module also creates a
// Firebase user document, which cannot run under `node --test`. Tests that exercise
// the login flow only need the viewer payload.

export const viewerCalls: (string | undefined)[] = [];

const DEFAULT_VIEWER = {
  id: 7,
  name: "meze",
  about: null,
  bannerImage: null,
  createdAt: 1600000000,
  avatar: { large: "https://example.test/avatar-large.jpg", medium: "https://example.test/avatar-medium.jpg" },
  options: { titleLanguage: "romaji", displayAdultContent: false, activityMergeTime: 0 },
  favourites: { anime: { nodes: [] }, manga: { nodes: [] } },
  statistics: { anime: { minutesWatched: 0 }, manga: { chaptersRead: 0 } },
};

type ViewerBag = { __anilistViewer?: unknown; __anilistViewerFails?: boolean };

export function getCurrUserData({ accessToken }: { accessToken?: string }) {
  viewerCalls.push(accessToken);

  const bag = globalThis as unknown as ViewerBag;

  if (bag.__anilistViewerFails) return Promise.resolve(undefined);

  return Promise.resolve(bag.__anilistViewer ?? DEFAULT_VIEWER);
}

export default { getCurrUserData };
