# Database

## Tables and access
- `anime`: catalog columns `anilist_id`, IDs, titles, description, images, format/status/season, episode metadata, genres, score, flags, sync timestamps, audit timestamps. Anon/authenticated read; service role writes.
- `episodes`: `play_id`, `anilist_id`, episode number, titles, description, image, air date, duration, filler/recap, providers, resolution, resync and audit fields. Anon/authenticated read; service role writes.
- `anime_import_queue`: queue state and retry fields. Service role only.
- `pending_sync`: episode sync queue and retry fields. Service role only.
- `episode_check_state`: per-anime checker state. Service role only.
- `cron_runs`: job execution audit fields. Service role only.
- `profiles`: user preferences and timestamps. Authenticated user reads/updates own row; signup trigger/service role creates.
- `public_profiles`: public identity projection. Anon/authenticated read; service role writes underlying profiles.
- `favourites`: `user_id`, `anilist_id`, snapshot, created_at. Authenticated owner read/write.
- `watchlist`: `user_id`, `anilist_id`, status, progress, snapshot, updated_at. Authenticated owner read/write.
- `watch_progress`: owner, anime/episode, position, duration, audio, completion, updated_at. Authenticated owner read/write.
- `comments`: target, author, parent, body, spoiler/deletion and audit fields. Public non-deleted read; authenticated author creates/updates/deletes.
- `comment_reactions`: comment/user/value/timestamp. Public read; authenticated owner writes.

## Relationships
```
auth.users 1--1 profiles
     | 1--* favourites
     | 1--* watchlist
     | 1--* watch_progress
     | 1--* comments 1--* comment_reactions
anime 1--* episodes
anime 1--1 episode_check_state
comments 1--* comments (parent_id)
```

## Title logos (prompt 25)

`public.anime` gained `logo_path`, `logo_aspect_ratio`, `logo_width`,
`logo_status` (`found` | `none` | `error`) and `logo_checked_at`. The migration
is `supabase/migrations/20261108000000_prompt25_logos.sql`. Read the page code
tolerates the columns being absent (a missing column simply means "no logo").
