-- Minimal Supabase stand-in so the real migrations can run on a plain
-- PostgreSQL: the auth schema, the three API roles, auth.uid() / auth.jwt(),
-- and the default privileges Supabase gives new tables in `public`.
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text,
  is_anonymous boolean not null default false,
  raw_app_meta_data jsonb default '{}'::jsonb
);

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid;
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

grant usage on schema public, auth to anon, authenticated, service_role;

-- Supabase grants these to every new object in public by default. Setting
-- them here is what makes the community migration's `revoke ... from anon,
-- authenticated` on staff_roles a real test instead of a no-op.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

grant select on auth.users to anon, authenticated, service_role;

-- public.airing_episodes was a legacy object that 20261027000000 attaches a
-- trigger to; it no longer exists in the app, so the harness recreates the
-- shape the migration expects.
create table if not exists public.airing_episodes (
  id bigserial primary key,
  anilist_id bigint,
  episode int,
  title text,
  title_english text,
  cover_url text,
  aired_at timestamptz default now()
);
