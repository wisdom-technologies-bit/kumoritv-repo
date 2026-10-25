# Authentication migration audit

## Firebase authentication usage

### Changed in Prompt 8
- `frontend/app/components/UserLoginModal/index.tsx` — login, signup, Google, anonymous, and AniList UI. Supabase replacement is in progress; AniList is removed from the alternatives UI.
- `frontend/app/layout/header/components/User/UserSideMenu/index.tsx` — header auth state and sign-out. Supabase `useUser()` compatibility is being introduced while AniList Redux support remains intact.
- `frontend/app/layout/header/components/User/UserSettingsModal/index.tsx` — profile/settings and account deletion. Supabase profile writes and delete API are the target replacement.
- `frontend/app/lib/user/userLoginActions.ts` — Firebase profile creation/update helper; retained for Prompt 9 compatibility audit and no longer a source of Supabase authorization.
- `frontend/app/firebaseApp.ts` — Firebase client bootstrap; intentionally retained because Prompt 9 data readers still import it.

### Shared auth primitives added now
- `frontend/app/lib/supabase/browser.ts` — browser client.
- `frontend/app/lib/supabase/server.ts` — server client and `getUser`/`requireUser` helpers.
- `frontend/app/lib/supabase/auth.ts` — shared safe redirect sanitizer.
- `frontend/app/lib/supabase/AuthProvider.tsx` — client auth/profile state.
- `frontend/app/auth/callback/route.ts` — PKCE callback.
- `frontend/app/api/account/delete/route.ts` — caller-scoped account deletion.

## Firebase/Firestore user-data usage deferred to Prompt 9

The following files still read or write Firestore data and must be migrated to the existing Supabase tables in Prompt 9. They must not be treated as authentication sources after this migration:

- `frontend/app/components/Buttons/AddToFavourites/index.tsx`
- `frontend/app/components/Buttons/AddToList/index.tsx`
- `frontend/app/components/Buttons/AddToNotification/index.tsx`
- `frontend/app/components/Buttons/MarkEpisodeAsWatched/index.tsx`
- `frontend/app/components/Buttons/MarkChapterAsRead/index.tsx`
- `frontend/app/components/HomePage/KeepWatchingSection/index.tsx`
- `frontend/app/components/HomePage/KeepWatchingSection/components/KeepWatchingEpisodeInfo/index.tsx`
- `frontend/app/my-lists/components/NavigationSideBar/index.tsx`
- `frontend/app/my-lists/components/MediasContainer/index.tsx`
- `frontend/app/favourites/components/NavigationSideBar/index.tsx`
- `frontend/app/favourites/components/PlaylistItemsResults/index.tsx`
- `frontend/app/components/[DEPRECATED]CommentsSection/index.tsx`
- `frontend/app/components/[DEPRECATED]CommentsSection/components/CommentContainer/index.tsx`
- `frontend/app/components/[DEPRECATED]CommentsSection/components/WriteCommentForm/index.tsx`
- `frontend/app/lib/user/userDocFetchOptions.ts`
- `frontend/app/lib/user/userDocUpdateOptions.ts`
- `frontend/app/lib/user/userLoginActions.ts`

Prompt 9 must move favourites, lists/watchlist, watched progress, notifications, comments, and reactions to Supabase. Firebase remains installed intentionally for this compatibility boundary.

## Scope decisions

- No Firebase tables or Supabase tables are created or altered here.
- Adult-content preference is not written by the new Supabase profile helpers.
- No service-role key is exposed to browser code.
- Live Supabase/Google auth cannot be verified in this sandbox because integration credentials were declined.
