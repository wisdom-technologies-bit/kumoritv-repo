-- Prompt 10: comments

alter table public.comments enable row level security;
alter table public.comment_reactions enable row level security;

drop policy if exists "comments read" on public.comments;
create policy "comments read" on public.comments for select to anon, authenticated
  using (deleted_at is null or auth.uid() = user_id);
drop policy if exists "comments insert own" on public.comments;
create policy "comments insert own" on public.comments for insert to authenticated
  with check (auth.uid() = user_id);
drop policy if exists "comments update own" on public.comments;
create policy "comments update own" on public.comments for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "reactions read own" on public.comment_reactions;
create policy "reactions read own" on public.comment_reactions for select to authenticated
  using (auth.uid() = user_id);
drop policy if exists "reactions insert own" on public.comment_reactions;
create policy "reactions insert own" on public.comment_reactions for insert to authenticated
  with check (auth.uid() = user_id);
drop policy if exists "reactions update own" on public.comment_reactions;
create policy "reactions update own" on public.comment_reactions for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "reactions delete own" on public.comment_reactions;
create policy "reactions delete own" on public.comment_reactions for delete to authenticated
  using (auth.uid() = user_id);

create index if not exists comments_media_idx on public.comments (anilist_id, episode_number, created_at desc);
create index if not exists comments_parent_idx on public.comments (parent_id);

-- guard: rate limit, valid replies, and only the spoiler flag / soft delete may change
create or replace function public.comments_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from public.comments c where c.user_id = new.user_id and c.created_at > now() - interval '10 seconds') then
      raise exception 'You are commenting too fast. Please wait a few seconds.';
    end if;
    if new.parent_id is not null and not exists (
      select 1 from public.comments p
      where p.id = new.parent_id and p.parent_id is null and p.anilist_id = new.anilist_id and p.deleted_at is null
    ) then
      raise exception 'Invalid reply target.';
    end if;
  else
    new.user_id := old.user_id;
    new.anilist_id := old.anilist_id;
    new.episode_number := old.episode_number;
    new.parent_id := old.parent_id;
    new.body := old.body;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  return new;
end $$;

drop trigger if exists comments_guard_trg on public.comments;
create trigger comments_guard_trg before insert or update on public.comments
  for each row execute function public.comments_guard();

-- public read model: author name/photo + like/dislike counts, deleted comments hidden
create or replace view public.comment_feed as
select c.id, c.anilist_id, c.episode_number, c.parent_id, c.user_id, c.body, c.is_spoiler,
       c.created_at, p.username, p.display_name, p.avatar_url,
       coalesce(sum(case when r.value = 1 then 1 else 0 end), 0)::int as likes,
       coalesce(sum(case when r.value = -1 then 1 else 0 end), 0)::int as dislikes
from public.comments c
left join public.public_profiles p on p.id = c.user_id
left join public.comment_reactions r on r.comment_id = c.id
where c.deleted_at is null
group by c.id, p.username, p.display_name, p.avatar_url;
grant select on public.comment_feed to anon, authenticated;
