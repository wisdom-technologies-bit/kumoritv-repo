# Prompt 9 — Firestore → Supabase audit

Read `docs/auth-audit.md` first: it lists the authentication side (Prompt 8) and the
files that were deferred to this prompt. This page records, per file, which Firestore
field was still being read or written and what replaces it.

## Firestore fields → Supabase tables

| Firestore field | Supabase table | Module |
| --- | --- | --- |
| `bookmarks` | `favourites(user_id, anilist_id, snapshot)` | `app/lib/user-data/favourites.ts` |
| `mediaListSavedByStatus.<status>` | `watchlist(user_id, anilist_id, status, progress, snapshot, updated_at)` | `app/lib/user-data/lists.ts` |
| `episodesWatched`, `keepWatching` | `watch_progress(... episode_number, position_seconds, duration_seconds, completed, snapshot)` | `app/lib/user-data/progress.ts` |
| `notifications` (+ `notifications/{mediaId}/usersAssigned` collection) | `notification_subscriptions(user_id, anilist_id, snapshot)` + `notifications(id, user_id, anilist_id, episode, title, cover_url, created_at, read_at)` | `app/lib/user-data/notifications.ts` |
| preference fields (`autoNextEpisode`, `autoSkipIntroAndOutro`, `videoSubtitleLanguage`, `source`, `quality`) | `profiles(auto_next, auto_skip, subtitle_language, preferred_audio, video_quality)` | `app/lib/user-data/prefs.ts` |
| `showAdultContent` | removed — adult titles are never filtered out | — |
| `chaptersRead` | local device store (`kumori_chapters_read_v1`) until the manga prompt | `app/components/Buttons/MarkChapterAsRead/index.tsx` |
| `comments` | out of scope (replaced by a later prompt) | `[DEPRECATED]CommentsSection` untouched |

Status mapping: `CURRENT → watching`, `PLANNING → planning`, `COMPLETED → completed`,
`DROPPED → dropped`, `PAUSED → paused`, `REPEATING → repeating`. `COMPLETED` stores the
media episode count as `progress`, like the original did.

Guest storage keys: `kumori_favourites_v1`, `kumori_lists_v1`, `kumori_progress_v1`
(unchanged) and `kumori_chapters_read_v1`. Signed-in caches are user scoped
(`kumori_favourites_cache_<id>`, `kumori_lists_cache_<id>`, `kumori_prefs_cache_<id>`)
and cleared on sign out.

## Files that imported Firebase / Firestore / firebaseApp

| File | What it used | Now |
| --- | --- | --- |
| `app/components/Buttons/AddToFavourites/index.tsx` | `users/{id}.bookmarks` read + write | `favourites.ts` (`listFavourites`, `addFavourite`, `removeFavourite`, `isFavourite`) |
| `app/components/Buttons/AddToList/index.tsx` | `mediaListSavedByStatus`, `episodesWatched` | `lists.ts` + `progress.ts` (`markWatched`) |
| `app/components/Buttons/AddToNotification/index.tsx` | `notifications` collection, `usersAssigned`, `users/{id}.notifications` | `notifications.ts` (`subscribe`, `unsubscribe`, `isSubscribed`) |
| `app/components/Buttons/MarkEpisodeAsWatched/index.tsx` | local store only (listed in the audit) | `progress.ts` through `app/lib/local-store/progress.ts` |
| `app/components/Buttons/MarkChapterAsRead/index.tsx` | `users/{id}.chaptersRead` | local-only chapter store (no Firestore) |
| `app/components/HomePage/KeepWatchingSection/index.tsx` | `users/{id}.keepWatching` | `progress.ts` (`listContinueWatchingFromServer`) |
| `app/components/HomePage/KeepWatchingSection/components/KeepWatchingEpisodeInfo/index.tsx` | `users/{id}.keepWatching` (remove) | `progress.ts` (`deleteContinueWatching`) |
| `app/my-lists/components/NavigationSideBar/index.tsx` | `keepWatching` + `mediaListSavedByStatus` counts | `lists.ts` (`getListCounts`) + `progress.ts` |
| `app/my-lists/components/MediasContainer/index.tsx` | `keepWatching`, `mediaListSavedByStatus` | `lists.ts` (`listByStatus`) + `progress.ts` |
| `app/favourites/components/NavigationSideBar/index.tsx` | `bookmarks` counts | `favourites.ts` (`listFavourites`) |
| `app/favourites/components/PlaylistItemsResults/index.tsx` | `bookmarks` | `favourites.ts` (`listFavourites`) |
| `app/components/MediaCards/MediaCard/MediaActionOptionsButton/OptionsPanel/index.tsx` | `mediaListSavedByStatus` | `lists.ts` (`getListStatus`, `setListStatus`, `removeFromList`) |
| `app/media/[id]/components/AnimeEpisodesContainer/components/EpisodesOptionsPanel/index.tsx` | `episodesWatched` + `Firestore` prop | `progress.ts` (`markWatched`, `isWatched`) |
| `app/layout/header/components/Notifications/index.tsx` | `notifications`, `usersAssigned`, `users/{id}.notifications`, localStorage polling | `notifications.ts` (refresh on mount, on focus, every 5 min) |
| `app/layout/header/components/User/UserSettingsModal/index.tsx` | preference fields, `showAdultContent`, delete helpers | `prefs.ts` + `favourites.clearFavourites` / `progress.clearProgress` / `notifications.clearNotifications` |
| `app/components/HomePage/NavigationThroughMedias/index.tsx` | `showAdultContent` via `getUserAdultContentPreference` | adult lines removed, `showAdultContent: true` |
| `app/components/HomePage/MediaRankingSection/index.tsx` | `showAdultContent` via `getUserAdultContentPreference` | adult lines removed, `showAdultContent: true` |
| `app/components/HomePage/NewestMediaSection/index.tsx` | `react-firebase-hooks/auth` `useAuthState` (unused) | removed |
| `app/layout/header/components/SearchFormContainer/index.tsx` | `getFirebaseAuth()` (unused) | removed |
| `app/lib/user/userDocFetchOptions.ts` | `users/{id}.showAdultContent` | deleted |
| `app/lib/user/userDocUpdateOptions.ts` | `bookmarks`, `mediaListSavedByStatus` | delegates to the data layer, no Firebase import |
| `app/lib/user/userLoginActions.ts` | creates the `users/{id}` document on AniList login | kept as-is (allowed boundary) |
| `app/firebaseApp.ts` | Firebase bootstrap | kept (allowed boundary) |
| `app/components/[DEPRECATED]CommentsSection/**` | `comments` collection | untouched, replaced by a later prompt |

## Verification boundary

- No real Supabase project is reachable from the sandbox, so the modules were verified
  against an in-memory Supabase stand-in (`test-harness/fake-supabase.ts`).
- The database trigger (`airing_episodes_notify` → `fanout_episode_notifications`) could
  not be executed here; the SQL lives in
  `supabase/migrations/20261027000000_prompt9_user_data.sql`.
- `npx next build` succeeds and `npx tsc --noEmit` reports the same error set as `master`
  (no new errors from this prompt).
