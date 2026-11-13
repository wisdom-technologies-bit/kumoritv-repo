# Community: enabling it and running the SQL

Two things are separate and both are needed: the flag in the app, and the SQL in
the database. **Deploy the code first.** `app/lib/users/search.ts` reads other
users through `public_profiles`; the older code reads `profiles` directly, so
running `profiles-rls.sql` against the old deployment makes people search return
nothing.

## 1. Enable the flag

Set `COMMUNITY_ENABLED` on the deployment (any of `1`, `true`, `yes`, `on`) and
redeploy. It is read per request, so no rebuild is needed to flip it back: with
the flag off there is no footer link, `/community*` and `/api/community*` answer
404 (from middleware, so the status is real) and the bell keeps its old
behaviour.

## 2. Run the SQL, in this order

Run the files, in order, in the Supabase SQL editor. Each one is idempotent and
each has its own rollback.

1. `docs/sql/profiles-rls.sql`
2. `docs/sql/community.sql`

Do **not** also run `supabase/migrations/20261120000000_prompt38_community.sql`
in the same project: it is the same statements, kept in step with the two files
so a migration-based deploy works too. Run the files **or** the migration.

Before running `community.sql`, compare the live function with the repo, because
production may differ:

```sql
select pg_get_functiondef('public.comments_guard'::regproc);
```

The file header lists every behaviour the replacement preserves.

## 3. Grant the first admin

Roles live only in `public.staff_roles`, which has RLS on, no policies and no
`anon`/`authenticated` grants. It cannot be written from the app, by design:

```sql
insert into public.staff_roles (user_id, role)
select id, 'admin' from auth.users where email = '<owner email>'
on conflict (user_id) do update set role = excluded.role;
```

## 4. Verify

```sql
select relname, relrowsecurity from pg_class
 where relname in ('staff_roles','community_posts','community_reactions',
                   'community_reports','community_blocks','community_moderation_log');

select polname, polcmd from pg_policy where polrelid = 'public.staff_roles'::regclass;  -- no rows
select polname, polcmd from pg_policy where polrelid = 'public.profiles'::regclass;     -- owner-only

select proname, proacl from pg_proc
 where proname in ('community_feed_page') order by proname;
```

## 5. Rollback order

Reverse of the run order, because later files depend on earlier ones:

1. `docs/sql/community-rollback.sql`
2. `docs/sql/profiles-rls-rollback.sql`

The database is left exactly as it was: `profiles` RLS off again, the community
tables and the schedule/trigger additions dropped, `comments_guard` and
`comment_feed` restored to the versions recorded in the rollback file.
