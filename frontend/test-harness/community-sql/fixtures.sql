-- Deterministic fixtures for the community SQL tests. Inserted as the
-- database owner (RLS and the guards do not apply), with created_at values in
-- the past so the 10 s / 30 s / 1 h guards do not fire.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'alice@example.test'),
  ('00000000-0000-0000-0000-0000000000b2', 'bob@example.test'),
  ('00000000-0000-0000-0000-0000000000c3', 'carol@example.test'),
  ('00000000-0000-0000-0000-0000000000d4', 'admin@example.test')
on conflict (id) do nothing;

insert into public.profiles (id, username, display_name, show_adult) values
  ('00000000-0000-0000-0000-0000000000a1', 'alice', 'Alice', false),
  ('00000000-0000-0000-0000-0000000000b2', 'bob', 'Bob', true),
  ('00000000-0000-0000-0000-0000000000c3', 'carol', 'Carol', false),
  ('00000000-0000-0000-0000-0000000000d4', 'admin', 'Admin', false)
on conflict (id) do nothing;

insert into public.staff_roles (user_id, role)
  values ('00000000-0000-0000-0000-0000000000d4', 'admin')
on conflict (user_id) do update set role = excluded.role;

insert into public.anime (anilist_id, title, title_english, cover_url, is_adult) values
  (101, 'Sousou no Frieren', 'Frieren: Beyond Journey''s End', 'https://cdn.test/frieren.jpg', false),
  (202, 'Adult Show', 'Adult Show', 'https://cdn.test/adult.jpg', true)
on conflict (anilist_id) do nothing;

-- posts: three published (two of them share a timestamp, for cursor
-- stability), one hidden, one deleted
insert into public.community_posts (id, author_id, body, is_spoiler, status, created_at, deleted_at) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1',
   'First post about Frieren', false, 'published', now() - interval '3 hours', null),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b2',
   'Second post, same timestamp', false, 'published', now() - interval '2 hours', null),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000c3',
   'Third post, same timestamp', true, 'published', now() - interval '2 hours', null),
  ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000a1',
   'Hidden by staff', false, 'hidden', now() - interval '90 minutes', null),
  ('10000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000b2',
   'Deleted by author', false, 'published', now() - interval '80 minutes', now() - interval '70 minutes'),
  ('10000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-0000000000c3',
   'A spoiler post that must hide its body', true, 'published', now() - interval '70 minutes', null)
on conflict (id) do nothing;

insert into public.announcements (id, title, body, created_at, expires_at) values
  ('20000000-0000-0000-0000-000000000001', 'Community is live',
   'Discuss episodes here.', now() - interval '1 day', now() + interval '30 days'),
  ('20000000-0000-0000-0000-000000000002', 'Expired announcement',
   'Should never appear.', now() - interval '60 days', now() - interval '1 day')
on conflict (id) do nothing;

-- comments: one top-level anime comment, one reply, one on a published post,
-- one on the hidden post, one on a deleted post, one on an expired announcement
insert into public.comments (id, anilist_id, user_id, body, created_at) values
  ('30000000-0000-0000-0000-000000000001', 101, '00000000-0000-0000-0000-0000000000a1',
   'Anime comment', now() - interval '5 hours')
on conflict (id) do nothing;

insert into public.comments (id, anilist_id, parent_id, user_id, body, created_at) values
  ('30000000-0000-0000-0000-000000000002', 101, '30000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000b2', 'A reply', now() - interval '4 hours')
on conflict (id) do nothing;

insert into public.comments (id, target_type, post_id, user_id, body, created_at) values
  ('30000000-0000-0000-0000-000000000003', 'post', '10000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000b2', 'Comment on a live post', now() - interval '3 hours'),
  ('30000000-0000-0000-0000-000000000004', 'post', '10000000-0000-0000-0000-000000000004',
   '00000000-0000-0000-0000-0000000000b2', 'Comment on a hidden post', now() - interval '2 hours'),
  ('30000000-0000-0000-0000-000000000005', 'post', '10000000-0000-0000-0000-000000000005',
   '00000000-0000-0000-0000-0000000000b2', 'Comment on a deleted post', now() - interval '2 hours')
on conflict (id) do nothing;

insert into public.comments (id, target_type, announcement_id, user_id, body, created_at) values
  ('30000000-0000-0000-0000-000000000006', 'announcement', '20000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000c3', 'Comment on a live announcement', now() - interval '20 hours'),
  ('30000000-0000-0000-0000-000000000007', 'announcement', '20000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-0000000000c3', 'Comment on an expired announcement', now() - interval '20 hours')
on conflict (id) do nothing;
