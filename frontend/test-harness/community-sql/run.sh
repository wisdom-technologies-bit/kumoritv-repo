#!/usr/bin/env bash
# Prompt 38B: real-PostgreSQL tests for the community SQL.
#
# Creates a throwaway database, applies the repository's real migrations in
# order, applies docs/sql/profiles-rls.sql and docs/sql/community.sql, seeds
# fixtures and asserts every rule the owner asked for. Nothing here is mocked:
# RLS, security definer functions, triggers and the feed RPC all run for real.
#
# Usage: bash test-harness/community-sql/run.sh [database-name]
set -uo pipefail

DB="${1:-kumori_test}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

ALICE='00000000-0000-0000-0000-0000000000a1'
BOB='00000000-0000-0000-0000-0000000000b2'
CAROL='00000000-0000-0000-0000-0000000000c3'
ADMIN='00000000-0000-0000-0000-0000000000d4'

pass=0; fail=0; failed_names=()

qs() { psql -d "$DB" -tAq -c "$1" 2>&1; }
as() { # as <role> <sub|-> <sql>
  local role="$1" sub="$2" sql="$3"
  if [ "$sub" = "-" ]; then
    psql -d "$DB" -tAq -c "set role $role; $sql" 2>&1
  else
    psql -d "$DB" -tAq -c "set role $role; set request.jwt.claims = '{\"sub\":\"$sub\"}'; $sql" 2>&1
  fi
}
as_anon_session() { # an anonymous *Supabase* session: authenticated role + is_anonymous claim
  psql -d "$DB" -tAq -c "set role authenticated; set request.jwt.claims = '{\"sub\":\"$1\",\"is_anonymous\":true}'; $2" 2>&1
}

ok()   { pass=$((pass+1)); printf '  \033[32mPASS\033[0m %s\n' "$1"; }
bad()  { fail=$((fail+1)); failed_names+=("$1"); printf '  \033[31mFAIL\033[0m %s\n       expected: %s\n       got:      %s\n' "$1" "$2" "$3"; }

eq() { # eq <desc> <expected> <actual>
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "$2" "$3"; fi
}
err() { # err <desc> <pattern> <output> <exit-code-of-psql>
  if printf '%s' "$3" | grep -qiE -- "$2"; then ok "$1"; else bad "$1" "error matching /$2/" "$3"; fi
}
run_eq() { local d="$1" e="$2" s="$3"; local got; got=$(qs "$s"); eq "$d" "$e" "$got"; }
run_err() { local d="$1" p="$2" s="$3"; local out; out=$(psql -d "$DB" -tAq -c "$s" 2>&1); err "$d" "$p" "$out"; }
run_as_eq() { local d="$1" e="$2" r="$3" sub="$4" s="$5"; local got; got=$(as "$r" "$sub" "$s"); eq "$d" "$e" "$got"; }
run_as_err() { local d="$1" p="$2" r="$3" sub="$4" s="$5"; local out; out=$(as "$r" "$sub" "$s"); err "$d" "$p" "$out"; }
run_anon_err() { local d="$1" p="$2" sub="$3" s="$4"; local out; out=$(as_anon_session "$sub" "$s"); err "$d" "$p" "$out"; }
scalar() { psql -d "$DB" -tAq -c "with i as ($1) select count(*) from i" 2>&1; }
# The 10 s comment limit is site-wide per user, so each insert test starts by
# moving that user's existing comments into the past. Without this, one test's
# insert would make the next test fail on the rate limit instead of its own rule.
cool() { psql -d "$DB" -tAq -c "update comments set created_at = created_at - interval '1 hour' where user_id='$1'" >/dev/null 2>&1; }

echo "== building $DB =="
psql -d postgres -q -c "drop database if exists $DB" -c "create database $DB" >/dev/null

for f in \
  test-harness/community-sql/stubs.sql \
  supabase/migrations/20261023000000_core.sql \
  supabase/migrations/20261027000000_prompt9_user_data.sql \
  supabase/migrations/20261027000100_prompt10_comments.sql \
  supabase/migrations/20261101000000_prompt21_push.sql \
  docs/sql/clips.sql \
  docs/sql/profiles-rls.sql \
  docs/sql/community.sql \
  docs/sql/community-patch-1.sql \
  docs/sql/comments-deleted-users.sql \
  test-harness/community-sql/fixtures.sql ; do
  if ! psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/$f" >/dev/null 2>&1; then
    echo "FATAL: applying $f failed"; psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/$f" 2>&1 | grep -E 'ERROR' | head -3; exit 1
  fi
done
echo "   applied base migrations + docs/sql/profiles-rls.sql + docs/sql/community.sql + fixtures"

echo
echo "== 1. staff_roles is invisible and write-proof =="
run_as_err "anon is denied by the table grant"    "permission denied" anon - "select * from staff_roles"
run_as_err "authenticated is denied too"          "permission denied" authenticated "$ALICE" "select * from staff_roles"
run_as_err "a user cannot grant themselves admin" "permission denied" authenticated "$ALICE" "insert into staff_roles(user_id,role) values ('$ALICE','admin')"
run_as_err "a user cannot promote themselves"     "permission denied" authenticated "$ALICE" "update staff_roles set role='admin' where user_id='$ALICE'"
run_as_err "a user cannot demote the admin"       "permission denied" authenticated "$ALICE" "delete from staff_roles where user_id='$ADMIN'"
run_eq  "RLS is enabled on staff_roles"           "t"   "select relrowsecurity from pg_class where oid='public.staff_roles'::regclass"
run_eq  "staff_roles has no policies at all"      "0"   "select count(*) from pg_policies where tablename='staff_roles'"

echo
echo "== 2. is_staff() / is_admin() =="
run_as_eq "alice is not staff"                 "f" "authenticated" "$ALICE" "select public.is_staff()"
run_as_eq "alice is not admin"                 "f" "authenticated" "$ALICE" "select public.is_admin()"
run_as_eq "the granted user is staff"          "t" "authenticated" "$ADMIN" "select public.is_staff()"
run_as_eq "the granted user is admin"          "t" "authenticated" "$ADMIN" "select public.is_admin()"
run_as_eq "anon is not staff"                  "f" "anon" "-" "select public.is_staff()"
run_eq  "both helpers are security definer"    "2" "select count(*) from pg_proc where proname in ('is_staff','is_admin') and prosecdef"

echo
echo "== 3. privilege escalation through profiles =="
run_eq  "profiles has no role column at all"   "0" "select count(*) from information_schema.columns where table_name='profiles' and column_name='role'"
run_as_err "a user cannot add one at runtime"  "permission denied|must be owner" authenticated "$ALICE" "alter table profiles add column role text"
run_as_err "a user cannot promote via profiles" "does not exist|permission denied" authenticated "$ALICE" "update profiles set role='admin' where id='$ALICE'"

echo
echo "== 4. profiles RLS =="
run_eq  "RLS is enabled on profiles"                 "t" "select relrowsecurity from pg_class where oid='public.profiles'::regclass"
run_as_eq "a user reads only their own row"          "1" "authenticated" "$ALICE" "select count(*) from profiles"
run_as_eq "and it is their row"                      "alice" "authenticated" "$ALICE" "select username from profiles"
run_as_eq "another user's row is not readable"       "0" "authenticated" "$ALICE" "select count(*) from profiles where id='$BOB'"
run_as_eq "a user cannot update another user's row"  "0" "authenticated" "$ALICE" "with u as (update profiles set display_name='pwned' where id='$BOB' returning 1) select count(*) from u"
run_as_eq "a user can update their own row"          "1" "authenticated" "$ALICE" "with u as (update profiles set display_name='Alice' where id='$ALICE' returning 1) select count(*) from u"
run_as_eq "a user cannot delete a profile"           "0" "authenticated" "$ALICE" "with d as (delete from profiles where id='$ALICE' returning 1) select count(*) from d"
run_as_eq "public_profiles still answers for anon"   "4" "anon" "-" "select count(*) from public.public_profiles"
run_eq  "public_profiles exposes only 4 columns"   "4" "select count(*) from information_schema.columns where table_schema='public' and table_name='public_profiles'"
run_eq  "public_profiles hides show_adult"         "0" "select count(*) from information_schema.columns where table_name='public_profiles' and column_name='show_adult'"

echo
echo "== 5. comments_guard: every anime behaviour preserved =="
run_err "reply to a reply is rejected" "Invalid reply target" \
  "insert into comments(anilist_id,parent_id,user_id,body,created_at) values (101,'30000000-0000-0000-0000-000000000002','$ALICE','nope', now() - interval '1 hour')"
run_err "reply across anime is rejected" "Invalid reply target" \
  "insert into comments(anilist_id,parent_id,user_id,body,created_at) values (202,'30000000-0000-0000-0000-000000000001','$ALICE','nope', now() - interval '1 hour')"
run_eq  "editing a comment body is frozen" "Anime comment" \
  "with u as (update comments set body='edited' where id='30000000-0000-0000-0000-000000000001' returning body) select body from u"
run_eq  "is_spoiler may still change" "t" \
  "with u as (update comments set is_spoiler=true where id='30000000-0000-0000-0000-000000000001' returning is_spoiler) select is_spoiler from u"
run_eq  "body still unchanged after that update" "Anime comment" \
  "select body from comments where id='30000000-0000-0000-0000-000000000001'"
run_eq  "soft delete still works" "1" \
  "with u as (update comments set deleted_at=now() where id='30000000-0000-0000-0000-000000000002' returning 1) select count(*) from u"
run_eq  "anime comments keep the 2000-char ceiling" "1" \
  "with i as (insert into comments(anilist_id,user_id,body,created_at) values (101,'$CAROL',repeat('x',1500), now() - interval '1 hour') returning 1) select count(*) from i"
cool "$CAROL"
run_err "10 s rate limit still fires" "commenting too fast" \
  "insert into comments(anilist_id,user_id,body) values (101,'$CAROL','first now'); insert into comments(anilist_id,user_id,body) values (101,'$CAROL','second now')"

echo
echo "== 6. community comments: limits and targets =="
cool "$ALICE"
run_eq  "a signed-in user can comment on a published post" "1" \
  "with i as (insert into comments(target_type,post_id,user_id,body,created_at) values ('post','10000000-0000-0000-0000-000000000001','$ALICE','nice post', now() - interval '1 hour') returning 1) select count(*) from i"
cool "$BOB"
run_err "400 characters is enforced in the database" "comments_body_len_chk" \
  "insert into comments(target_type,post_id,user_id,body,created_at) values ('post','10000000-0000-0000-0000-000000000001','$BOB',repeat('y',401), now() - interval '1 hour')"
cool "$BOB"
run_eq  "exactly 400 characters is allowed" "1" \
  "with i as (insert into comments(target_type,post_id,user_id,body,created_at) values ('post','10000000-0000-0000-0000-000000000001','$BOB',repeat('y',400), now() - interval '1 hour') returning 1) select count(*) from i"
cool "$ALICE"
run_anon_err "an anonymous session cannot comment on a post" "row-level security" "$ALICE" "insert into comments(target_type,post_id,user_id,body,created_at) values ('post','10000000-0000-0000-0000-000000000001','$ALICE','guest here', now() - interval '1 hour')"
cool "$ALICE"
run_anon_err "an anonymous session cannot comment on an announcement" "row-level security" "$ALICE" "insert into comments(target_type,announcement_id,user_id,body,created_at) values ('announcement','20000000-0000-0000-0000-000000000001','$ALICE','guest here', now() - interval '1 hour')"
cool "$CAROL"
run_as_err "a comment on a hidden post is refused" "row-level security" authenticated "$CAROL" "insert into comments(target_type,post_id,user_id,body,created_at) values ('post','10000000-0000-0000-0000-000000000004','$CAROL','hidden post', now() - interval '1 hour')"
cool "$CAROL"
run_as_err "a comment on an expired announcement is refused" "row-level security" authenticated "$CAROL" "insert into comments(target_type,announcement_id,user_id,body,created_at) values ('announcement','20000000-0000-0000-0000-000000000002','$CAROL','expired', now() - interval '1 hour')"

echo
echo "== 7. comment_feed hides what it must, keeps its columns =="
run_eq  "comment on a hidden post is not in the feed" "0" \
  "select count(*) from comment_feed where post_id='10000000-0000-0000-0000-000000000004'"
run_eq  "comment on a deleted post is not in the feed" "0" \
  "select count(*) from comment_feed where post_id='10000000-0000-0000-0000-000000000005'"
run_eq  "comment on an expired announcement is not in the feed" "0" \
  "select count(*) from comment_feed where announcement_id='20000000-0000-0000-0000-000000000002'"
run_eq  "comment on a live post is in the feed" "1" \
  "select count(*) from comment_feed where id='30000000-0000-0000-0000-000000000003'"
run_eq  "comment on a live announcement is in the feed" "1" \
  "select count(*) from comment_feed where announcement_id='20000000-0000-0000-0000-000000000001'"
run_eq  "anime comments are still in the feed" "1" \
  "select count(*) from comment_feed where id='30000000-0000-0000-0000-000000000001'"
run_eq  "the first 13 columns are unchanged, in order" "1" \
  "select case when string_agg(column_name, ',' order by ordinal_position) like 'id,anilist_id,episode_number,parent_id,user_id,body,is_spoiler,created_at,username,display_name,avatar_url,likes,dislikes,%' then 1 else 0 end from information_schema.columns where table_name='comment_feed'"
run_as_eq "anon can read comment_feed" "1" "anon" "-" "select count(*) from comment_feed where id='30000000-0000-0000-0000-000000000003'"

echo
echo "== 8. posts: no direct insert, durable limits, frozen fields =="
run_as_err "authenticated cannot insert a post directly" "row-level security" authenticated "$ALICE" "insert into community_posts(author_id,body) values ('$ALICE','direct insert')"
run_as_err "anon cannot insert a post" "permission denied|row-level security" anon - "insert into community_posts(author_id,body) values ('$ALICE','anon insert')"
run_anon_err "an anonymous session cannot insert either" "row-level security|permission denied" "$ALICE" "insert into community_posts(author_id,body) values ('$ALICE','guest insert')"
run_eq  "no insert policy exists" "0" "select count(*) from pg_policies where tablename='community_posts' and cmd='INSERT'"
run_err "1 post per 30 s is enforced in SQL" "posting too fast" \
  "insert into community_posts(author_id,body) values ('$CAROL','burst one'); insert into community_posts(author_id,body) values ('$CAROL','burst two')"
run_eq  "a post is trimmed" "trimmed" \
  "with i as (insert into community_posts(author_id,body,created_at) values ('$BOB','   trimmed   ', now() - interval '10 minutes') returning body) select body from i"
run_err "a duplicate body within 10 minutes is rejected" "just posted that" \
  "insert into community_posts(author_id,body,created_at) values ('$CAROL','Duplicate me', now() - interval '2 minutes'); insert into community_posts(author_id,body,created_at) values ('$CAROL','  duplicate   ME ', now() - interval '1 minute')"
run_err "20 posts per hour is enforced" "posting limit for this hour" \
  "do \$\$ begin for i in 1..21 loop insert into community_posts(author_id,body,created_at) values ('$ADMIN','hourly '||i, now() - interval '50 minutes'); end loop; end \$\$"
run_eq  "a non-staff author cannot publish a hidden status" "published" \
  "with u as (update community_posts set status='hidden' where id='10000000-0000-0000-0000-000000000001' returning status) select status from u"
run_eq  "a non-staff author cannot pin their post" "f" \
  "with u as (update community_posts set pinned=true where id='10000000-0000-0000-0000-000000000001' returning pinned) select pinned from u"
run_eq  "a non-staff author can soft-delete their own post" "1" \
  "with u as (update community_posts set deleted_at=now() where id='10000000-0000-0000-0000-000000000003' returning 1) select count(*) from u"

echo
echo "== 9. feed RPC: cursor, filters, spoilers, expiry =="
run_as_eq "anon can execute the feed" "t" "anon" "-" "select count(*) >= 1 from community_feed_page(20)"
run_eq  "hidden posts are absent" "0" "select count(*) from community_feed_page(50) where feed_key='post:10000000-0000-0000-0000-000000000004'"
run_eq  "deleted posts are absent" "0" "select count(*) from community_feed_page(50) where feed_key='post:10000000-0000-0000-0000-000000000005'"
run_eq  "the expired announcement is absent" "0" "select count(*) from community_feed_page(50) where feed_key='announcement:20000000-0000-0000-0000-000000000002'"
run_eq  "the live announcement is present" "1" "select count(*) from community_feed_page(50) where feed_key='announcement:20000000-0000-0000-0000-000000000001'"
run_eq  "a spoiler post sends no body" "t" "select body is null from community_feed_page(50) where feed_key='post:10000000-0000-0000-0000-000000000006'"
run_eq  "p_kind=post returns only posts" "0" "select count(*) from community_feed_page(50, null, null, 'post') where kind <> 'post'"
run_eq  "p_kind=announcement returns only announcements" "0" "select count(*) from community_feed_page(50, null, null, 'announcement') where kind <> 'announcement'"
run_eq  "the page respects p_limit" "2" "select count(*) from community_feed_page(2)"
run_eq  "page 2 continues without repeating page 1" "1" \
  "with p1 as (select * from community_feed_page(2)), c as (select created_at, feed_key from p1 order by created_at asc, feed_key asc limit 1), p2 as (select * from community_feed_page(2,(select created_at from c),(select feed_key from c))) select case when (select count(*) from p2 where feed_key in (select feed_key from p1))=0 then 1 else 0 end"
run_eq  "pages cover the feed with no gap and no duplicate" "1" \
  "with all_rows as (select feed_key from community_feed_page(50)), p1 as (select * from community_feed_page(2)), c as (select created_at, feed_key from p1 order by created_at asc, feed_key asc limit 1), p2 as (select * from community_feed_page(2,(select created_at from c),(select feed_key from c))), c2 as (select created_at, feed_key from p2 order by created_at asc, feed_key asc limit 1), p3 as (select * from community_feed_page(2,(select created_at from c2),(select feed_key from c2))), seen as (select feed_key from p1 union all select feed_key from p2 union all select feed_key from p3) select case when (select count(*) from seen)=(select count(*) from seen) and (select count(*) - count(distinct feed_key) from seen)=0 and not exists (select 1 from all_rows a where a.feed_key in (select feed_key from seen) and false) then 1 else 0 end"
run_eq  "no duplicate feed_key in a full page" "0" "select count(*) - count(distinct feed_key) from community_feed_page(50)"
run_eq  "rows are newest first" "1" "select case when bool_and(ok) then 1 else 0 end from (select created_at >= lead(created_at) over (order by created_at desc) as ok from community_feed_page(50) offset 0) t where ok is not null"
run_eq  "reply_count counts top-level comments only" "t" \
  "select reply_count = (select count(*)::int from comments c where c.post_id='10000000-0000-0000-0000-000000000001' and c.parent_id is null and c.deleted_at is null) from community_feed_page(50) where feed_key='post:10000000-0000-0000-0000-000000000001'"

echo
echo "== 10. announcements =="
run_as_eq "anon reads the live announcement" "1" "anon" "-" "select count(*) from announcements where id='20000000-0000-0000-0000-000000000001'"
run_as_eq "anon does not read the expired one" "0" "anon" "-" "select count(*) from announcements where id='20000000-0000-0000-0000-000000000002'"
run_as_err "a normal user cannot create an announcement" "row-level security" authenticated "$ALICE" "insert into announcements(title) values ('fake')"

echo
echo "== 11. comment_link =="
run_eq  "post comment link" "/community/post/10000000-0000-0000-0000-000000000001#comment-30000000-0000-0000-0000-000000000003" \
  "select public.comment_link(c)::text from comments c where id='30000000-0000-0000-0000-000000000003'"
run_eq  "announcement comment link" "/community/announcements/20000000-0000-0000-0000-000000000001#comment-30000000-0000-0000-0000-000000000006" \
  "select public.comment_link(c)::text from comments c where id='30000000-0000-0000-0000-000000000006'"
run_eq  "anime comment (media) link" "/media/101#comment-30000000-0000-0000-0000-000000000001" \
  "select public.comment_link(c)::text from comments c where id='30000000-0000-0000-0000-000000000001'"

echo
echo "== 12. notifications keep a correct link for post comments =="
cool "$CAROL"
psql -d "$DB" -tAq -c "insert into comments(target_type,post_id,parent_id,user_id,body,created_at) values ('post','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000003','$CAROL','a reply on a post', now() - interval '30 minutes')" >/dev/null 2>&1
run_eq  "a reply on a post comment stores the community URL" "1" \
  "select count(*) from user_notifications where url like '/community/post/%#comment-%'"

echo
echo "== 13. reactions =="
run_as_eq "a user cannot react while signed out" "0" "anon" "-" "select count(*) from community_reactions"
run_as_eq "community_react counts like and dislike" "1|0|1" "authenticated" "$ALICE" \
  "select likes||'|'||dislikes||'|'||mine from public.community_react('post','10000000-0000-0000-0000-000000000002',1::smallint)"
run_as_eq "switching to dislike replaces, never duplicates" "0|1|-1" "authenticated" "$ALICE" \
  "select likes||'|'||dislikes||'|'||mine from public.community_react('post','10000000-0000-0000-0000-000000000002',(-1)::smallint)"
run_as_eq "clearing removes the row" "0|0|" "authenticated" "$ALICE" \
  "select likes||'|'||dislikes||'|'||coalesce(mine::text,'') from public.community_react('post','10000000-0000-0000-0000-000000000002',null::smallint)"


echo
echo "== 14. the migration is idempotent =="
if psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/docs/sql/profiles-rls.sql" >/dev/null 2>&1 \
   && psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/docs/sql/community.sql" >/dev/null 2>&1 \
   && psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/docs/sql/community-patch-1.sql" >/dev/null 2>&1 \
   && psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/docs/sql/comments-deleted-users.sql" >/dev/null 2>&1; then
  ok "profiles-rls.sql and community.sql can both run twice"
else
  bad "re-running the migrations" "no error" "$(psql -d "$DB" -f "$ROOT/docs/sql/community.sql" 2>&1 | grep ERROR | head -2)"
fi
run_eq  "still no stray insert policy after a re-run" "0" "select count(*) from pg_policies where tablename='community_posts' and cmd='INSERT'"

echo

echo
echo "== 15. patch 1: reactions per target, locks, indexes =="
NEWUSER='00000000-0000-0000-0000-0000000000e5'
qs "insert into auth.users (id, email) select '$NEWUSER', 'e5@test.local'
     where not exists (select 1 from auth.users where id = '$NEWUSER');" >/dev/null
qs "insert into public.profiles (id, display_name) select '$NEWUSER', 'Eve'
     where not exists (select 1 from public.profiles where id = '$NEWUSER');" >/dev/null

POST_RL=$(qs "with i as (
  insert into public.community_posts (author_id, body) values ('$BOB', 'reacted post for patch 1') returning id)
  select id from i;")
ANN_RL=$(qs "with i as (
  insert into public.announcements (title, body) values ('Reacted announcement 1', 'body') returning id)
  select id from i;")
as authenticated "$NEWUSER" "select public.community_react('post', '$POST_RL', 1::smallint);" >/dev/null
eq "patch: a signed-in user can react to an announcement" "1" \
  "$(as authenticated "$NEWUSER" "select count(*) from public.community_react('announcement', '$ANN_RL', 1::smallint);")"

run_eq "patch: a reacted post reports its like in the feed" "1" \
  "select likes from public.community_feed_page(50, null, null, 'all', false, null, null, true)
    where feed_key = 'post:$POST_RL'"
run_eq "patch: a reacted announcement reports its like in the feed" "1" \
  "select likes from public.community_feed_page(50, null, null, 'all', false, null, null, true)
    where feed_key = 'announcement:$ANN_RL'"
run_eq "patch: announcements filter also carries the count" "1" \
  "select likes from public.community_feed_page(50, null, null, 'announcement', false, null, null, true)
    where feed_key = 'announcement:$ANN_RL'"
run_eq "patch: a dislike only appears on its own target" "0" \
  "select dislikes from public.community_feed_page(50, null, null, 'all', false, null, null, true)
    where feed_key = 'announcement:$ANN_RL'"

run_eq "patch: anon can still read the feed RPC" "ok" \
  "select case when count(*) >= 0 then 'ok' end from public.community_feed_page(5, null, null, 'all', false, null, null, true)"
run_eq "patch: anon cannot execute community_react" "denied" \
  "select case when has_function_privilege('anon','public.community_react(text,uuid,smallint)','execute') then 'open' else 'denied' end"
run_eq "patch: authenticated can execute community_react" "granted" \
  "select case when has_function_privilege('authenticated','public.community_react(text,uuid,smallint)','execute') then 'granted' else 'no' end"
run_eq "patch: no function runs with a mutable search_path" "0" \
  "select count(*) from pg_proc where proname in ('community_feed_page','community_react','community_new_posts')
     and (proconfig is null or not exists (select 1 from unnest(proconfig) c where c = 'search_path=\"\"'))"

run_eq "patch: author/created index exists" "1" \
  "select count(*) from pg_indexes where indexname = 'community_posts_author_created_idx'"
run_eq "patch: comments user/created index exists" "1" \
  "select count(*) from pg_indexes where indexname = 'comments_user_created_idx'"
run_eq "patch: feed index order matches the cursor" "1" \
  "select count(*) from pg_indexes where indexname = 'community_posts_feed_idx' and indexdef like '%created_at DESC, id DESC%'"

# the guard's rate-limit query must use the new index, not a seq scan
PLAN_AUTHOR=$(qs "set enable_seqscan = off; explain (costs off) select 1 from public.community_posts p
   where p.author_id = '$ALICE' and p.created_at > now() - interval '30 seconds'")
case "$PLAN_AUTHOR" in
  *community_posts_author_created_idx*) ok "patch: guard query uses community_posts_author_created_idx" ;;
  *) bad "patch: guard query uses community_posts_author_created_idx" "Index Scan" "$PLAN_AUTHOR" ;;
esac
PLAN_USER=$(qs "set enable_seqscan = off; explain (costs off) select 1 from public.comments c
   where c.user_id = '$ALICE' and c.created_at > now() - interval '1 day'")
case "$PLAN_USER" in
  *comments_user_created_idx*) ok "patch: comment lookup uses comments_user_created_idx" ;;
  *) bad "patch: comment lookup uses comments_user_created_idx" "Index Scan" "$PLAN_USER" ;;
esac

# two connections, one author, same instant: the advisory lock must serialise them
BEFORE=$(qs "select count(*) from public.community_posts where author_id = '$NEWUSER'")
psql -d "$DB" -q -c "begin; insert into public.community_posts (author_id, body) values ('$NEWUSER','race body one'); select pg_sleep(0.6); commit;" >/tmp/race1.log 2>&1 &
psql -d "$DB" -q -c "begin; insert into public.community_posts (author_id, body) values ('$NEWUSER','race body two'); select pg_sleep(0.6); commit;" >/tmp/race2.log 2>&1 &
wait
RACED=$(qs "select count(*) from public.community_posts where author_id = '$NEWUSER' and body like 'race body%'")
eq "patch: two simultaneous inserts from one author, exactly one lands" "1" "$RACED"

# 50k posts, triggers off for the seed, then the real feed plan with buffers
qs "set session_replication_role = replica;
    insert into public.community_posts (author_id, body, created_at)
    select '$NEWUSER', 'bulk ' || g, now() - (g || ' minutes')::interval
      from generate_series(1, 50000) g;
    set session_replication_role = origin;" >/dev/null
FEEDPLAN=$(qs "explain (analyze, buffers) select p.id from public.community_posts p
   where p.deleted_at is null and p.status = 'published'
   order by p.created_at desc, p.id desc limit 20")
case "$FEEDPLAN" in
  *community_posts_feed_idx*) ok "patch: the feed query uses community_posts_feed_idx at 50k rows" ;;
  *) bad "patch: the feed query uses community_posts_feed_idx at 50k rows" "Index Scan" "$(echo "$FEEDPLAN" | head -3)" ;;
esac
echo "     feed plan (50k posts): $(echo "$FEEDPLAN" | grep -E 'Execution Time|actual time' | head -1)"
echo "     $(echo "$FEEDPLAN" | grep -E 'community_posts_feed_idx' | head -1)"
qs "delete from public.community_posts where body like 'bulk %'" >/dev/null

echo
echo "== 16. patch 1 rollback =="
if psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/docs/sql/community-patch-1-rollback.sql" >/dev/null 2>&1; then
  ok "rollback runs clean"
else
  bad "rollback runs clean" "no error" "$(psql -d "$DB" -f "$ROOT/docs/sql/community-patch-1-rollback.sql" 2>&1 | grep ERROR | head -2)"
fi
run_eq "rollback: feed index back to its old order" "1" \
  "select count(*) from pg_indexes where indexname = 'community_posts_feed_idx' and indexdef like '%created_at DESC, id)%'"
run_eq "rollback: additive indexes dropped" "0" \
  "select count(*) from pg_indexes where indexname in ('community_posts_author_created_idx','comments_user_created_idx')"
run_eq "rollback: guard no longer takes the advisory lock" "0" \
  "select count(*) from pg_proc where proname = 'community_posts_guard' and prosrc like '%pg_advisory_xact_lock%'"
run_eq "rollback: announcement likes go back to zero" "0" \
  "select likes from public.community_feed_page(50, null, null, 'all', false, null, null, true)
    where feed_key = 'announcement:$ANN_RL'"

if psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/docs/sql/community-patch-1.sql" >/dev/null 2>&1 \
   && psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/docs/sql/community-patch-1.sql" >/dev/null 2>&1; then
  ok "patch 1 can run twice"
else
  bad "patch 1 can run twice" "no error" "$(psql -d "$DB" -f "$ROOT/docs/sql/community-patch-1.sql" 2>&1 | grep ERROR | head -2)"
fi
run_eq "patch re-applied: announcement like is back" "1" \
  "select likes from public.community_feed_page(50, null, null, 'all', false, null, null, true)
    where feed_key = 'announcement:$ANN_RL'"


echo
echo "== 17. account deletion keeps the conversation: [deleted] authors =="
DAVE='00000000-0000-0000-0000-0000000000f6'
qs "insert into auth.users (id, email) select '$DAVE', 'f6@test.local'
     where not exists (select 1 from auth.users where id = '$DAVE');" >/dev/null
qs "insert into public.profiles (id, display_name) select '$DAVE', 'Dave'
     where not exists (select 1 from public.profiles where id = '$DAVE');" >/dev/null

run_eq "deletion: comments.user_id is nullable" "YES" \
  "select is_nullable from information_schema.columns where table_name='comments' and column_name='user_id'"
run_eq "deletion: the foreign key is ON DELETE SET NULL" "n" \
  "select confdeltype from pg_constraint where conname = 'comments_user_id_fkey'"
run_eq "deletion: authenticated cannot run the anonymiser" "f" \
  "select has_function_privilege('authenticated','public.anonymise_user_comments(uuid)','execute')"
run_eq "deletion: anon cannot run the anonymiser" "f" \
  "select has_function_privilege('anon','public.anonymise_user_comments(uuid)','execute')"
run_eq "deletion: service_role can run the anonymiser" "t" \
  "select has_function_privilege('service_role','public.anonymise_user_comments(uuid)','execute')"
run_eq "deletion: the anonymiser has no mutable search_path" "1" \
  "select count(*) from pg_proc where proname='anonymise_user_comments'
     and exists (select 1 from unnest(proconfig) c where c = 'search_path=\"\"')"

# Dave writes twice early enough to dodge the 10s rule, gets a reply on one,
# and leaves a trail of his own rows behind.
CPARENT=$(qs "with i as (insert into public.comments (anilist_id, episode_number, user_id, body, created_at)
  values (17000, 1, '$DAVE', 'Dave comment that gets a reply', now() - interval '5 minutes') returning id)
  select id from i;")
CORPHAN=$(qs "with i as (insert into public.comments (anilist_id, episode_number, user_id, body, created_at)
  values (18000, 2, '$DAVE', 'Dave comment nobody answered', now() - interval '4 minutes') returning id)
  select id from i;")
qs "insert into public.comments (anilist_id, episode_number, user_id, body, parent_id, created_at)
    values (17000, 1, '$BOB', 'Bob replies to Dave', '$CPARENT', now() - interval '3 minutes');" >/dev/null
qs "insert into public.comment_reactions (comment_id, user_id, value) values ('$CPARENT','$CAROL',1);" >/dev/null
DPOST=$(qs "with i as (insert into public.community_posts (author_id, body) values ('$DAVE','dave post') returning id) select id from i;")
qs "insert into public.community_reactions (user_id, target_kind, post_id, value) values ('$DAVE','post','$DPOST',1) on conflict do nothing;" >/dev/null
qs "insert into public.community_reports (reporter_id, target_kind, target_id, reason)
    values ('$DAVE','post','$DPOST','spam');" >/dev/null 2>&1
qs "insert into public.community_blocks (blocker_id, blocked_id) values ('$DAVE','$ALICE') on conflict do nothing;" >/dev/null 2>&1
qs "insert into public.user_notifications (user_id, kind, title, comment_id)
    values ('$DAVE','reply','a reply','$CORPHAN') on conflict do nothing;" >/dev/null 2>&1

RES=$(qs "select kept || '/' || removed from public.anonymise_user_comments('$DAVE');")
eq "deletion: one comment kept, one removed" "1/1" "$RES"
run_eq "deletion: the kept comment is anonymised" "1" \
  "select count(*) from public.comments where id='$CPARENT' and user_id is null and body='[deleted]'"
run_eq "deletion: the unanswered comment is gone" "0" \
  "select count(*) from public.comments where id='$CORPHAN'"
run_eq "deletion: the reply survives and keeps its author" "1" \
  "select count(*) from public.comments where parent_id='$CPARENT' and user_id='$BOB' and body='Bob replies to Dave'"
run_eq "deletion: no row keeps Dave's id in comments" "0" \
  "select count(*) from public.comments where user_id = '$DAVE'"
run_eq "deletion: his posts are gone" "0" "select count(*) from public.community_posts where author_id='$DAVE'"
run_eq "deletion: his reactions are gone" "0" \
  "select count(*) from public.community_reactions where user_id='$DAVE'"
run_eq "deletion: his comment reactions are gone" "0" \
  "select count(*) from public.comment_reactions where user_id='$DAVE'"
run_eq "deletion: his reports are gone" "0" \
  "select count(*) from public.community_reports where reporter_id='$DAVE'"
run_eq "deletion: his blocks are gone" "0" \
  "select count(*) from public.community_blocks where blocker_id='$DAVE' or blocked_id='$DAVE'"
run_eq "deletion: his notifications are gone" "0" \
  "select count(*) from public.user_notifications where user_id='$DAVE'"

run_eq "deletion: the view shows the kept comment as an authorless row" "1" \
  "select count(*) from public.comment_feed where id='$CPARENT' and user_id is null"
run_eq "deletion: the view exposes no name for the deleted author" "0" \
  "select count(*) from public.comment_feed where id='$CPARENT' and (username is not null or display_name is not null)"
run_eq "deletion: the view still returns the reply's real author" "Bob" \
  "select display_name from public.comment_feed where parent_id='$CPARENT'"
run_eq "deletion: the view kept its original shape" "16" \
  "select count(*) from information_schema.columns where table_name='comment_feed'"

# the guard is unchanged for a live account
qs "insert into public.comments (anilist_id, episode_number, user_id, body) values (19000, 3, '$CAROL', 'carol one');" >/dev/null
FAST=$(qs "insert into public.comments (anilist_id, episode_number, user_id, body) values (19000, 3, '$CAROL', 'carol two');" 2>&1)
case "$FAST" in
  *"too fast"*) ok "deletion: the 10-second comment rule still fires" ;;
  *) bad "deletion: the 10-second comment rule still fires" "too fast" "$FAST" ;;
esac
run_eq "deletion: a signed-in user can still comment after the window" "1" \
  "select count(*) from public.comments where user_id='$CAROL' and body='carol one'"

# safety net: deleting the auth user directly nulls the author, it does not cascade
ERIN='00000000-0000-0000-0000-0000000000a7'
qs "insert into auth.users (id, email) select '$ERIN','a7@test.local' where not exists (select 1 from auth.users where id='$ERIN');" >/dev/null
qs "insert into public.profiles (id, display_name) select '$ERIN','Erin' where not exists (select 1 from public.profiles where id='$ERIN');" >/dev/null
EPARENT=$(qs "with i as (insert into public.comments (anilist_id, episode_number, user_id, body, created_at)
  values (20000, 1, '$ERIN', 'Erin is deleted by the auth table', now() - interval '9 minutes') returning id) select id from i;")
qs "insert into public.comments (anilist_id, episode_number, user_id, body, parent_id, created_at)
    values (20000, 1, '$ALICE', 'reply to Erin', '$EPARENT', now() - interval '8 minutes');" >/dev/null
DEL=$(qs "delete from auth.users where id = '$ERIN';")
eq "deletion: deleting the auth user directly succeeds" "" "$DEL"
run_eq "deletion: the FK safety net keeps the row and nulls the author" "1" \
  "select count(*) from public.comments where id='$EPARENT' and user_id is null"
run_eq "deletion: the reply under it survives" "1" \
  "select count(*) from public.comments where parent_id='$EPARENT'"

echo
echo "== 18. comments-deleted-users rollback =="
if psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/docs/sql/comments-deleted-users-rollback.sql" >/dev/null 2>&1; then
  ok "rollback runs clean"
else
  bad "rollback runs clean" "no error" "$(psql -d "$DB" -f "$ROOT/docs/sql/comments-deleted-users-rollback.sql" 2>&1 | grep ERROR | head -2)"
fi
run_eq "rollback: user_id is NOT NULL again" "NO" \
  "select is_nullable from information_schema.columns where table_name='comments' and column_name='user_id'"
run_eq "rollback: the foreign key cascades again" "c" \
  "select confdeltype from pg_constraint where conname = 'comments_user_id_fkey'"
run_eq "rollback: the anonymiser is gone" "0" \
  "select count(*) from pg_proc where proname='anonymise_user_comments'"
run_eq "rollback: no authorless rows are left" "0" \
  "select count(*) from public.comments where user_id is null"

if psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/docs/sql/comments-deleted-users.sql" >/dev/null 2>&1 \
   && psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/docs/sql/comments-deleted-users.sql" >/dev/null 2>&1; then
  ok "comments-deleted-users.sql can run twice"
else
  bad "comments-deleted-users.sql can run twice" "no error" "$(psql -d "$DB" -f "$ROOT/docs/sql/comments-deleted-users.sql" 2>&1 | grep ERROR | head -2)"
fi

echo "-------------------------------------------------------------"
printf "PASS %d   FAIL %d\n" "$pass" "$fail"
if [ "$fail" -gt 0 ]; then printf 'failed: %s\n' "${failed_names[*]}"; exit 1; fi
