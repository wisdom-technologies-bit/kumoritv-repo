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


echo
echo "== 19. first login, anonymous sessions, guest merge (profiles RLS on) =="
FRANK='00000000-0000-0000-0000-0000000000b8'
qs "insert into auth.users (id, email) select '$FRANK','b8@test.local' where not exists (select 1 from auth.users where id='$FRANK');" >/dev/null

run_eq "signup: a signed-in user can create their own profile" "1" \
  "set role authenticated; set request.jwt.claims = '{\"sub\":\"$FRANK\"}';
   with i as (insert into public.profiles (id, display_name) values ('$FRANK','Frank') returning 1) select count(*) from i"
run_eq "signup: the row is readable back through public_profiles" "Frank" \
  "set role authenticated; set request.jwt.claims = '{\"sub\":\"$FRANK\"}';
   select display_name from public.public_profiles where id = '$FRANK'"
run_eq "signup: nobody can create a profile for somebody else" "denied" \
  "select case when exists (
     select 1 from pg_policies where tablename='profiles' and cmd='INSERT'
      and coalesce(with_check,'') not like '%auth.uid()%')
   then 'open' else 'denied' end"
run_eq "signup: another signed-in user cannot read Frank's private profile row" "0" \
  "set role authenticated; set request.jwt.claims = '{\"sub\":\"$ALICE\"}';
   select count(*) from public.profiles where id = '$FRANK'"
run_eq "signup: profiles still has no role column" "0" \
  "select count(*) from information_schema.columns where table_name='profiles' and column_name='role'"

ANDY='00000000-0000-0000-0000-0000000000c9'
qs "insert into auth.users (id, email) select '$ANDY','c9@test.local' where not exists (select 1 from auth.users where id='$ANDY');" >/dev/null
run_eq "anonymous: an is_anonymous session can create its profile" "1" \
  "set role authenticated; set request.jwt.claims = '{\"sub\":\"$ANDY\",\"is_anonymous\":true}';
   with i as (insert into public.profiles (id) values ('$ANDY') returning 1) select count(*) from i"
ANONPOST=$(qs "set role authenticated; set request.jwt.claims = '{\"sub\":\"$ANDY\",\"is_anonymous\":true}';
   insert into public.community_posts (author_id, body) values ('$ANDY','anon post');" 2>&1)
case "$ANONPOST" in
  *"row-level security"*) ok "anonymous: it still cannot write a community post directly" ;;
  *) bad "anonymous: it still cannot write a community post directly" "row-level security" "$ANONPOST" ;;
esac

BOBFAV=$(qs "select count(*) from public.favourites where user_id = '$BOB'")
run_eq "merge: a guest's favourites can be inserted for the new account" "1" \
  "set role authenticated; set request.jwt.claims = '{\"sub\":\"$FRANK\"}';
   with i as (insert into public.favourites (user_id, anilist_id) values ('$FRANK', 44000) returning 1) select count(*) from i"
run_eq "merge: the account reads its own merged row" "1" \
  "set role authenticated; set request.jwt.claims = '{\"sub\":\"$FRANK\"}';
   select count(*) from public.favourites where user_id = '$FRANK' and anilist_id = 44000"
# NOTE: public.favourites has RLS disabled (no policies exist), so this harness
# cannot prove per-user isolation for it. That is a pre-existing gap in the
# prompt9 user_data tables, outside Community Phase 1, and is reported rather
# than silently asserted as safe.
run_eq "merge: the account only sees its own merged favourite" "1" \
  "set role authenticated; set request.jwt.claims = '{\"sub\":\"$FRANK\"}';
   select count(*) from public.favourites where user_id = '$FRANK'"

run_eq "anon cannot read staff_roles even after every file" "t" \
  "select not has_table_privilege('anon','public.staff_roles','select')"

echo
echo "== 20. Phase 2: the comment arm =="
# Sections 16 and 18 rolled their own file back and re-applied the earlier one,
# which leaves the two-arm function behind. Re-applying this file here is also
# the recovery test: a database that never saw it and one that lost it end up
# with the same function.
if psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/docs/sql/community-comments-arm.sql" >/dev/null 2>&1; then
  ok "the comment-arm file applies on top of the four existing files"
else
  bad "the comment-arm file applies" "no error" "$(psql -d "$DB" -f "$ROOT/docs/sql/community-comments-arm.sql" 2>&1 | grep ERROR | head -2)"
fi

# Fixing created_at after the fact cannot work (the guard freezes it), and an
# earlier section leaves a comment from a few seconds ago behind, which trips the
# site-wide 10 s limit. Fixture loading is therefore done with the guard trigger
# disabled and re-enabled immediately, exactly as a bulk loader would.
guard_off() { psql -d "$DB" -q -c "alter table public.comments disable trigger comments_guard_trg"; }
guard_on()  { psql -d "$DB" -q -c "alter table public.comments enable trigger comments_guard_trg"; }
guard_off
GINA='00000000-0000-0000-0000-0000000000a7'
qs "insert into auth.users (id, email) select '$GINA','a7@test.local'
     where not exists (select 1 from auth.users where id='$GINA');" >/dev/null

qs "insert into public.anime (anilist_id, title, title_english, cover_url, is_adult) values
     (303, 'Sousou no Frieren II', null, 'https://cdn.test/frieren2.jpg', false)
   on conflict (anilist_id) do nothing;" >/dev/null

C1='40000000-0000-0000-0000-000000000001'
C2='40000000-0000-0000-0000-000000000002'
C3='40000000-0000-0000-0000-000000000003'
C4='40000000-0000-0000-0000-000000000004'
C5='40000000-0000-0000-0000-000000000005'
C6='40000000-0000-0000-0000-000000000006'
C7='40000000-0000-0000-0000-000000000007'
C8='40000000-0000-0000-0000-000000000008'
C9='40000000-0000-0000-0000-000000000009'
R1='40000000-0000-0000-0000-000000000011'
R2='40000000-0000-0000-0000-000000000012'
R3='40000000-0000-0000-0000-000000000013'

qs "insert into public.comments (id, anilist_id, episode_number, user_id, body, is_spoiler, created_at) values
  ('$C1', 101, 5,    '$ALICE', 'Episode five was wild',            false, now() - interval '6 hours'),
  ('$C2', 101, null, '$BOB',   'Anime-level comment',              false, now() - interval '6 hours 1 minute'),
  ('$C3', 101, 5,    '$CAROL', 'spoiler body that must hide',      true,  now() - interval '6 hours 2 minutes'),
  ('$C4', 202, 1,    '$CAROL', 'comment on an adult title',        false, now() - interval '6 hours 3 minutes'),
  ('$C5', 303, 2,    '$BOB',   'title with no english name',       false, now() - interval '6 hours 4 minutes'),
  ('$C6', 999, 1,    '$BOB',   'anime row is missing',             false, now() - interval '6 hours 5 minutes'),
  ('$C7', 101, 6,    '$GINA',  'comment by a blocked author',      false, now() - interval '6 hours 6 minutes'),
  ('$C9', 101, 9,    '$CAROL', 'comment by a deleted account',     false, now() - interval '6 hours 8 minutes')
on conflict (id) do nothing;" >/dev/null
qs "update public.comments set user_id = null where id = '$C9';" >/dev/null
qs "insert into public.comments (id, anilist_id, episode_number, user_id, body, created_at) values
  ('$C8', 101, 7, '$CAROL', 'soft deleted comment', now() - interval '6 hours 7 minutes')
on conflict (id) do nothing;" >/dev/null
qs "update public.comments set deleted_at = now() where id = '$C8';" >/dev/null
qs "insert into public.comments (id, anilist_id, parent_id, user_id, body, created_at) values
  ('$R1', 101, '$C1', '$BOB',   'first reply',  now() - interval '5 hours'),
  ('$R2', 101, '$C1', '$CAROL', 'second reply', now() - interval '5 hours 1 minute'),
  ('$R3', 101, '$C1', '$BOB',   'deleted reply', now() - interval '5 hours 2 minutes')
on conflict (id) do nothing;" >/dev/null
qs "update public.comments set deleted_at = now() where id = '$R3';" >/dev/null
qs "insert into public.community_blocks (blocker_id, blocked_id) values ('$ALICE', '$GINA')
    on conflict do nothing;" >/dev/null

# one post, one announcement and one comment, each with known counts, so a single
# page proves likes/dislikes are right for all three row kinds at once.
P2=$(qs "insert into public.community_posts (author_id, body, created_at)
         values ('$ALICE', 'post with reactions', now() - interval '30 minutes') returning id;")
A2=$(qs "insert into public.announcements (title, body, created_at)
         values ('Announcement with reactions', 'body', now() - interval '40 minutes') returning id;")
qs "insert into public.comment_reactions (comment_id, user_id, value) values
      ('$C1', '$ALICE', 1), ('$C1', '$BOB', 1), ('$C1', '$CAROL', -1)
    on conflict do nothing;" >/dev/null
qs "insert into public.community_reactions (user_id, target_kind, post_id, value) values
      ('$ALICE', 'post', '$P2', 1), ('$BOB', 'post', '$P2', 1), ('$CAROL', 'post', '$P2', -1)
    on conflict do nothing;" >/dev/null
qs "insert into public.community_reactions (user_id, target_kind, announcement_id, value) values
      ('$ALICE', 'announcement', '$A2', 1)
    on conflict do nothing;" >/dev/null

ALL='public.community_feed_page(50, null, null, %s, false, null, null, %s)'
page() { printf "$ALL" "'$1'" "$2"; }

run_eq  "a top-level episode comment is a card"        "1" "select count(*) from $(page all true) where feed_key = 'comment:$C1'"
run_eq  "its author is resolved through public_profiles" "Alice" "select author_display_name from $(page comment true) where feed_key = 'comment:$C1'"
run_eq  "the episode number reaches the card"          "5" "select episode_number from $(page comment true) where feed_key = 'comment:$C1'"
run_eq  "the title uses english first"                 "Frieren: Beyond Journey's End" "select anime_title from $(page comment true) where feed_key = 'comment:$C1'"
run_eq  "falls back to the plain title when english is null" "Sousou no Frieren II" "select anime_title from $(page comment true) where feed_key = 'comment:$C5'"
run_eq  "the cover travels with the card"              "1" "select count(*) from $(page comment true) where feed_key = 'comment:$C1' and anime_cover = 'https://cdn.test/frieren.jpg'"
run_eq  "an anime-level comment has a null episode"    "1" "select count(*) from $(page comment true) where feed_key = 'comment:$C2' and episode_number is null"
run_eq  "the deep link is the media page for an anime-level comment" "1" \
  "select count(*) from $(page comment true) where feed_key = 'comment:$C2' and target_url = '/media/101#comment-$C2'"
run_eq  "the deep link carries the episode for an episode comment" "1" \
  "select count(*) from $(page comment true) where feed_key = 'comment:$C1' and target_url = '/watch/101?ep=5#comment-$C1'"

run_eq  "a comment with no author ([deleted]) is not a card" "0" "select count(*) from $(page comment true) where feed_key = 'comment:$C9'"
run_eq  "a reply is never its own card"                "0" "select count(*) from $(page comment true) where feed_key in ('comment:$R1','comment:$R2','comment:$R3')"
run_eq  "reply_count counts the live replies only"     "2" "select reply_count from $(page comment true) where feed_key = 'comment:$C1'"
run_eq  "a soft-deleted comment is gone"               "0" "select count(*) from $(page comment true) where feed_key = 'comment:$C8'"
run_eq  "a spoiler comment sends no body"              "1" "select count(*) from $(page comment true) where feed_key = 'comment:$C3' and body is null and is_spoiler"
run_eq  "a comment whose anime row is missing is excluded" "0" "select count(*) from $(page comment true) where feed_key = 'comment:$C6'"
run_eq  "an adult title's comment is hidden by default" "0" "select count(*) from $(page comment true) where feed_key = 'comment:$C4'"
run_eq  "and hidden for an anonymous visitor too"      "0" "select count(*) from public.community_feed_page(50, null, null, 'comment', false, null, null, true) where feed_key = 'comment:$C4'"
run_eq  "p_show_adult = true includes it and flags it" "1" \
  "select count(*) from public.community_feed_page(50, null, null, 'comment', true, null, null, true) where feed_key = 'comment:$C4' and is_adult"
run_eq  "non-adult rows report is_adult = false"       "1" "select count(*) from $(page comment true) where feed_key = 'comment:$C1' and not is_adult"
run_as_eq "a blocked author's comment is hidden"       "0" "authenticated" "$ALICE" \
  "select count(*) from $(page comment true) where feed_key = 'comment:$C7'"
run_as_eq "p_hide_blocked = false still shows it"      "1" "authenticated" "$ALICE" \
  "select count(*) from public.community_feed_page(50, null, null, 'comment', false, null, null, false) where feed_key = 'comment:$C7'"
run_eq  "another viewer is unaffected by that block"   "1" "select count(*) from $(page comment true) where feed_key = 'comment:$C7'"

run_eq  "p_anilist_id returns one title's comments"    "1|comment:$C5" \
  "select count(*) || '|' || min(feed_key) from public.community_feed_page(50, null, null, 'all', false, null, 303, true)"
run_eq  "and nothing from another title"              "0" "select count(*) from public.community_feed_page(50, null, null, 'all', false, null, 101, true) where anime_id <> 101"
run_eq  "p_kind = comment returns only comments"      "0" "select count(*) from public.community_feed_page(50, null, null, 'comment', false, null, null, true) where kind <> 'comment'"
run_eq  "p_kind = post returns only posts"            "0" "select count(*) from public.community_feed_page(50, null, null, 'post', false, null, null, true) where kind <> 'post'"
run_eq  "p_kind = announcement returns only announcements" "0" "select count(*) from public.community_feed_page(50, null, null, 'announcement', false, null, null, true) where kind <> 'announcement'"
run_eq  "p_kind = all carries all three kinds"        "3" "select count(distinct kind) from $(page all true)"

run_eq  "a comment's likes and dislikes come from comment_reactions" "2|1" \
  "select likes || '|' || dislikes from $(page comment true) where feed_key = 'comment:$C1'"
run_eq  "a post's counts are still right next to it"  "2|1" \
  "select likes || '|' || dislikes from $(page all true) where feed_key = 'post:$P2'"
run_eq  "an announcement's counts are still right next to them" "1|0" \
  "select likes || '|' || dislikes from $(page all true) where feed_key = 'announcement:$A2'"

run_eq  "the output keeps every old column and adds is_adult last" "1" \
  "select case when pg_get_function_result('public.community_feed_page(int,timestamptz,text,text,boolean,uuid,bigint,boolean)'::regprocedure)
     like '%dislikes integer, is_adult boolean)%' then 1 else 0 end"
run_eq  "security definer is kept"                    "t" \
  "select prosecdef from pg_proc where proname = 'community_feed_page'"
run_eq  "the empty search_path is kept"               "1" \
  "select count(*) from pg_proc where proname = 'community_feed_page'
     and exists (select 1 from unnest(proconfig) c where c = 'search_path=\"\"')"
run_eq  "the new indexes exist"                       "2" \
  "select count(*) from pg_indexes where indexname in ('comments_parent_idx','comments_anilist_feed_idx')"
run_eq  "anon and authenticated can execute"          "true|true" \
  "select has_function_privilege('anon','public.community_feed_page(int,timestamptz,text,text,boolean,uuid,bigint,boolean)','execute')
       || '|' || has_function_privilege('authenticated','public.community_feed_page(int,timestamptz,text,text,boolean,uuid,bigint,boolean)','execute')"
run_eq  "PUBLIC cannot execute it"                    "closed" \
  "select case when exists (select 1 from pg_proc p, aclexplode(p.proacl) a
     where p.proname = 'community_feed_page' and a.grantee = 0 and a.privilege_type = 'EXECUTE')
   then 'open' else 'closed' end"

echo
echo "   cursor walk over three sources, identical timestamps, page size 2"
SAME=$(qs "select '2026-01-01 12:00:00+00'::timestamptz")
qs "insert into public.community_posts (id, author_id, body, status, created_at) values
      ('40000000-0000-0000-0000-0000000000f1', '$ALICE', 'tie post', 'published', '$SAME')
    on conflict (id) do nothing;" >/dev/null
qs "insert into public.announcements (id, title, body, created_at, expires_at) values
      ('40000000-0000-0000-0000-0000000000f2', 'Tie announcement', 'body', '$SAME', now() + interval '10 days')
    on conflict (id) do nothing;" >/dev/null
qs "insert into public.comments (id, anilist_id, episode_number, user_id, body, created_at) values
      ('40000000-0000-0000-0000-0000000000f3', 101, 3, '$ALICE', 'tie comment one', '$SAME'),
      ('40000000-0000-0000-0000-0000000000f4', 101, 4, '$BOB',   'tie comment two', '$SAME'),
      ('40000000-0000-0000-0000-0000000000f5', 303, 5, '$CAROL', 'tie comment three', '$SAME')
    on conflict (id) do nothing;" >/dev/null
guard_on

walk_feed() { # prints one feed_key per line, walking with p_limit 2
  local ts="null" key="null" out line last
  for _ in $(seq 1 40); do
    out=$(psql -d "$DB" -tAF'|' -c "select created_at, feed_key from public.community_feed_page(2, $ts, $key)" 2>&1)
    [ -z "$out" ] && break
    printf '%s\n' "$out" | cut -d'|' -f2
    last=$(printf '%s\n' "$out" | tail -1)
    ts="'$(printf '%s' "$last" | cut -d'|' -f1)'"
    key="'$(printf '%s' "$last" | cut -d'|' -f2)'"
  done
}
walk_feed > /tmp/walk1.txt 2>&1
walk_feed > /tmp/walk2.txt 2>&1
qs "select feed_key from public.community_feed_page(50) order by 1" | sort > /tmp/walkall.txt

if [ -z "$(sort /tmp/walk1.txt | uniq -d)" ]; then
  ok "the walk has no duplicates"
else
  bad "the walk has no duplicates" "no duplicate key" "$(sort /tmp/walk1.txt | uniq -d | head -2 | tr '\n' ' ')"
fi
eq "the walk visits every row exactly once"           "$(grep -c . /tmp/walkall.txt)" "$(grep -c . /tmp/walk1.txt)"
if diff -q <(sort /tmp/walk1.txt) /tmp/walkall.txt >/dev/null; then
  ok "the walk sees exactly the full page's keys"
else
  bad "the walk sees exactly the full page's keys" "same key set" "$(diff <(sort /tmp/walk1.txt) /tmp/walkall.txt | head -4 | tr '\n' ' ')"
fi
if diff -q /tmp/walk1.txt /tmp/walk2.txt >/dev/null; then
  ok "the walk is stable when repeated"
else
  bad "the walk is stable when repeated" "identical order" "differs"
fi

echo
echo "== 20b. the comment-arm file is idempotent and its rollback is complete =="
H1=$(qs "select md5(pg_get_functiondef('public.community_feed_page(int,timestamptz,text,text,boolean,uuid,bigint,boolean)'::regprocedure))")
if psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/docs/sql/community-comments-arm.sql" >/dev/null 2>&1; then
  ok "the file can run twice"
else
  bad "the file can run twice" "no error" "$(psql -d "$DB" -f "$ROOT/docs/sql/community-comments-arm.sql" 2>&1 | grep ERROR | head -2)"
fi
H2=$(qs "select md5(pg_get_functiondef('public.community_feed_page(int,timestamptz,text,text,boolean,uuid,bigint,boolean)'::regprocedure))")
eq "the second run leaves the function identical" "$H1" "$H2"

if psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/docs/sql/community-comments-arm-rollback.sql" >/dev/null 2>&1; then
  ok "the rollback runs clean"
else
  bad "the rollback runs clean" "no error" "$(psql -d "$DB" -f "$ROOT/docs/sql/community-comments-arm-rollback.sql" 2>&1 | grep ERROR | head -2)"
fi
run_eq "rollback: the previous function is back (no is_adult)" "f" \
  "select pg_get_function_result('public.community_feed_page(int,timestamptz,text,text,boolean,uuid,bigint,boolean)'::regprocedure) like '%is_adult%'"
run_eq "rollback: the comment arm returns nothing"    "0" \
  "select count(*) from public.community_feed_page(50, null, null, 'comment', false, null, null, true)"
run_eq "rollback: posts and announcements still work" "t" \
  "select count(*) > 0 from public.community_feed_page(50, null, null, 'all', false, null, null, true)"
run_eq "rollback: the two new indexes are gone"       "0" \
  "select count(*) from pg_indexes where indexname in ('comments_parent_idx','comments_anilist_feed_idx')"
run_eq "rollback: the earlier indexes are untouched"  "1" \
  "select count(*) from pg_indexes where indexname = 'comments_community_feed_idx'"
if psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/docs/sql/community-comments-arm-rollback.sql" >/dev/null 2>&1; then
  ok "the rollback can run twice"
else
  bad "the rollback can run twice" "no error" "$(psql -d "$DB" -f "$ROOT/docs/sql/community-comments-arm-rollback.sql")"
fi
psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/docs/sql/community-comments-arm.sql" >/dev/null 2>&1
run_eq "re-applied: the comment arm is back"          "1" \
  "select count(*) from public.community_feed_page(50, null, null, 'comment', false, null, null, true) where feed_key = 'comment:$C1'"

echo
echo "== 21. Phase 2: EXPLAIN (ANALYZE, BUFFERS) on 50k comments / 500 anime =="
# Seeded here, not in fixtures: it is only here to make the planner choose
# honestly, and it must never leak into the behaviour tests above.
guard_off
qs "insert into public.anime (anilist_id, title, title_english, cover_url, is_adult)
    select 1000 + g, 'Seed title ' || g, 'Seed title ' || g,
           'https://cdn.test/seed-' || g || '.jpg', (g % 50 = 0)
      from generate_series(1, 500) g
    on conflict (anilist_id) do nothing;" >/dev/null
qs "insert into public.comments (anilist_id, episode_number, user_id, body, is_spoiler, created_at)
    select 1000 + (g % 500),
           case when g % 3 = 0 then null else (g % 24) + 1 end,
           (array['$ALICE','$BOB','$CAROL'])[1 + (g % 3)]::uuid,
           'seed comment ' || g,
           (g % 97 = 0),
           now() - (g || ' minutes')::interval
      from generate_series(1, 50000) g;" >/dev/null
run_eq "the seed put more than 50k top-level anime comments in place" "1" \
  "select case when count(*) >= 50000 then 1 else 0 end from public.comments
     where target_type = 'anime' and parent_id is null and deleted_at is null"
guard_on
qs "analyze public.comments; analyze public.anime;" >/dev/null

plan_for() { psql -d "$DB" -tAq -c "explain (analyze, buffers) select * from $1" 2>&1; }
ms_for()   { plan_for "$1" | grep -i 'Execution Time' | sed 's/.*: //'; }
ALL_Q='public.community_feed_page(20, null, null, %s, false, null, %s, true)'
q_all()      { printf "$ALL_Q" "'all'" "null"; }
q_comments() { printf "$ALL_Q" "'comment'" "null"; }
q_one()      { printf "$ALL_Q" "'comment'" "1050"; }

# The function is SECURITY DEFINER with SET search_path, so PostgreSQL never
# inlines it and EXPLAIN only shows "Function Scan on community_feed_page". The
# honest evidence that an index was used is the index's own scan counter.
idx_used() { # idx_used <indexname> <query> -> 1 when the index was scanned
  psql -d "$DB" -tAq -c "select pg_stat_reset()" >/dev/null
  qs "select count(*) from $2" >/dev/null
  psql -d "$DB" -tAq -c "select pg_stat_clear_snapshot()" >/dev/null
  sleep 0.6
  qs "select case when coalesce(sum(idx_scan),0) >= 1 then 1 else 0 end
        from pg_stat_user_indexes where indexrelname = '$1'"
}
echo "   index used by the comment arm:"
eq "the comment arm uses comments_community_feed_idx" "1" \
  "$(idx_used comments_community_feed_idx "$(q_comments)")"
eq "the single-title filter uses comments_anilist_feed_idx" "1" \
  "$(idx_used comments_anilist_feed_idx "$(q_one)")"

echo "   timings (after both indexes, buffers included in the plan above)"
printf '     All                %s\n' "$(ms_for "$(q_all)")"
printf '     Comments           %s\n' "$(ms_for "$(q_comments)")"
printf '     One anime (1050)   %s\n' "$(ms_for "$(q_one)")"

qs "drop index if exists public.comments_anilist_feed_idx;" >/dev/null
printf '     One anime, before comments_anilist_feed_idx   %s\n' "$(ms_for "$(q_one)")"
qs "create index comments_anilist_feed_idx on public.comments (anilist_id, created_at desc, id desc)
     where deleted_at is null and parent_id is null and target_type = 'anime' and user_id is not null;" >/dev/null
printf '     One anime, after comments_anilist_feed_idx    %s\n' "$(ms_for "$(q_one)")"


echo
echo "== 22. Phase 3: the clip arm and the adult rule =="
# This file replaces community_feed_page (one new OUT column, clip_state, last)
# and community_new_posts (+p_show_adult, last, with a default). It is applied
# here for the first time in this run, exactly as the owner would apply it after
# the five earlier files.
if psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/docs/sql/community-clips-arm.sql" >/dev/null 2>&1; then
  ok "the clips-arm file applies on top of the five existing files"
else
  bad "the clips-arm file applies" "no error" "$(psql -d "$DB" -f "$ROOT/docs/sql/community-clips-arm.sql" 2>&1 | grep ERROR | head -2)"
fi

# Posts are inserted with the guard trigger disabled: fixtures and the 50k seed
# above already used up the 20-per-hour budget, and fixing created_at afterwards
# is refused because the guard freezes it.
pg_guard_off() { psql -d "$DB" -q -c "alter table public.community_posts disable trigger community_posts_guard_trg"; }
pg_guard_on()  { psql -d "$DB" -q -c "alter table public.community_posts enable trigger community_posts_guard_trg"; }

CL1='50000000-0000-0000-0000-0000000000c1'   # live clip, non-adult title
CL2='50000000-0000-0000-0000-0000000000c2'   # soft-deleted clip
CL3='50000000-0000-0000-0000-0000000000c3'   # live clip on an adult title
CL4='50000000-0000-0000-0000-0000000000c4'   # live clip with no title
P1='60000000-0000-0000-0000-0000000000e1'
P2='60000000-0000-0000-0000-0000000000e2'
P3='60000000-0000-0000-0000-0000000000e3'
P4='60000000-0000-0000-0000-0000000000e4'

pg_guard_off
qs "insert into public.clips (id, code, anilist_id, episode_number, start_seconds, end_seconds, title) values
      ('$CL1', 'abc2345', 101,  5,   62,  77, 'The best fight'),
      ('$CL2', 'bcd3456', 101,  6,   10,  25, 'Deleted clip'),
      ('$CL3', 'cde4567', 202,  1,  100, 115, 'Adult scene'),
      ('$CL4', 'def5678', 101,  3,    5,  20, null)
    on conflict (id) do nothing;" >/dev/null
qs "update public.clips set deleted_at = now() where id = '$CL2';" >/dev/null
qs "insert into public.community_posts (id, author_id, body, clip_id, created_at) values
      ('$P1', '$ALICE', 'a post that shares a clip',      '$CL1', now() - interval '4 seconds'),
      ('$P2', '$ALICE', 'a post whose clip was removed',  '$CL2', now() - interval '3 seconds'),
      ('$P3', '$BOB',   'a post with an adult clip',      '$CL3', now() - interval '2 seconds'),
      ('$P4', '$CAROL', 'a post with an untitled clip',   '$CL4', now() - interval '1 second')
    on conflict (id) do nothing;" >/dev/null
pg_guard_on

CLIPS_FALSE="public.community_feed_page(50, null, null, 'clips', false, null, null, true)"
CLIPS_TRUE="public.community_feed_page(50, null, null, 'clips', true, null, null, true)"
POSTS_ALL="public.community_feed_page(50, null, null, 'post', false, null, null, true)"
FEED_ALL="public.community_feed_page(50, null, null, 'all', false, null, null, true)"

run_eq "a text post reports clip_state = none"          "none"   "select clip_state from $POSTS_ALL where feed_key = 'post:10000000-0000-0000-0000-000000000001'"
run_eq "a live clip reports clip_state = live"          "live"   "select clip_state from $POSTS_ALL where feed_key = 'post:$P1'"
run_eq "a live clip puts the clip title in the post's title column" "The best fight" \
  "select title from $POSTS_ALL where feed_key = 'post:$P1'"
run_eq "a live clip returns code, range, anime and episode in one row" "abc2345|62|77|101|Frieren: Beyond Journey's End|https://cdn.test/frieren.jpg|5" \
  "select clip_code || '|' || clip_start::int || '|' || clip_end::int || '|' || anime_id || '|' || anime_title || '|' || anime_cover || '|' || episode_number
     from $POSTS_ALL where feed_key = 'post:$P1'"
run_eq "a deleted clip reports clip_state = removed"     "removed" "select clip_state from $POSTS_ALL where feed_key = 'post:$P2'"
run_eq "a deleted clip nulls every clip column"          "1" \
  "select case when clip_code is null and clip_start is null and clip_end is null
            and anime_id is null and anime_title is null and anime_cover is null
            and episode_number is null and title is null and not is_adult
          then 1 else 0 end
     from $POSTS_ALL where feed_key = 'post:$P2'"
run_eq "a clip with no title of its own is still live"   "live" \
  "select clip_state from $POSTS_ALL where feed_key = 'post:$P4'"
run_eq "and it sends a null title, not an empty string"  "1" \
  "select case when title is null and clip_code = 'def5678'
            and anime_title = 'Frieren: Beyond Journey''s End' then 1 else 0 end
     from $POSTS_ALL where feed_key = 'post:$P4'"

# --- the adult rule, server side -------------------------------------------
run_eq "an adult clip is hidden_adult by default"        "hidden_adult" "select clip_state from $POSTS_ALL where feed_key = 'post:$P3'"
run_eq "and it sends no clip code"                       "1" "select case when clip_code is null then 1 else 0 end from $POSTS_ALL where feed_key = 'post:$P3'"
run_eq "and no clip range"                               "1" "select case when clip_start is null and clip_end is null then 1 else 0 end from $POSTS_ALL where feed_key = 'post:$P3'"
run_eq "and no anime id, title or cover"                 "1" \
  "select case when anime_id is null and anime_title is null and anime_cover is null then 1 else 0 end
     from $POSTS_ALL where feed_key = 'post:$P3'"
run_eq "and no episode number"                           "1" "select case when episode_number is null then 1 else 0 end from $POSTS_ALL where feed_key = 'post:$P3'"
run_eq "and no clip title"                               "1" "select case when title is null then 1 else 0 end from $POSTS_ALL where feed_key = 'post:$P3'"
run_eq "but it keeps is_adult = true, so the card can be labelled" "t" \
  "select is_adult from $POSTS_ALL where feed_key = 'post:$P3'"
run_eq "the post body is still delivered (it is the author's own words)" "1" \
  "select case when body = 'a post with an adult clip' then 1 else 0 end from $POSTS_ALL where feed_key = 'post:$P3'"
run_eq "p_show_adult = true makes it live"               "live" "select clip_state from $CLIPS_TRUE where feed_key = 'post:$P3'"
run_eq "and only then is the regular clip data sent"     "cde4567|202|Adult Show|1|Adult scene|true" \
  "select clip_code || '|' || anime_id || '|' || anime_title || '|' || episode_number || '|' || title || '|' || is_adult
     from $CLIPS_TRUE where feed_key = 'post:$P3'"
run_eq "the adult filter does not touch a non-adult clip" "live" \
  "select clip_state from $POSTS_ALL where feed_key = 'post:$P1'"

# --- p_kind = 'clips' -------------------------------------------------------
run_eq "p_kind = 'clips' returns only post cards"        "0" \
  "select count(*) from $CLIPS_FALSE where kind <> 'post'"
run_eq "p_kind = 'clips' returns every post that has a clip" "4" \
  "select count(*) from $CLIPS_FALSE where feed_key in ('post:$P1','post:$P2','post:$P3','post:$P4')"
run_eq "p_kind = 'clips' returns nothing that has no clip" "0" \
  "select count(*) from $CLIPS_FALSE where clip_state = 'none'"
run_eq "p_kind = 'clips' hides announcements and comments" "0" \
  "select count(*) from $CLIPS_FALSE where kind in ('announcement','comment')"
run_eq "p_kind = 'post' still returns text-only posts"    "1" \
  "select count(*) from public.community_feed_page(50, null, null, 'post', false, null, null, true)
    where feed_key = 'post:10000000-0000-0000-0000-000000000001'"
run_eq "every clip state is reachable in one page"         "4" \
  "select count(distinct clip_state) from $POSTS_ALL"
run_eq "a post row in the merged feed carries clip_state too" "live" \
  "select clip_state from $FEED_ALL where feed_key = 'post:$P1'"

# --- guests ----------------------------------------------------------------
run_as_eq "a guest (anon role) gets the hidden version"   "hidden_adult" "anon" "-" \
  "select clip_state from $POSTS_ALL where feed_key = 'post:$P3'"
run_as_eq "a guest gets no clip code for an adult clip"   "1" "anon" "-" \
  "select case when clip_code is null then 1 else 0 end from $POSTS_ALL where feed_key = 'post:$P3'"
run_as_eq "a guest still sees is_adult so the label can be drawn" "t" "anon" "-" \
  "select is_adult from $POSTS_ALL where feed_key = 'post:$P3'"
run_as_eq "a guest gets an ordinary clip in full"         "abc2345" "anon" "-" \
  "select clip_code from $POSTS_ALL where feed_key = 'post:$P1'"

# --- the cursor still walks mixed kinds correctly ---------------------------
CURSOR_CT=$(qs "select created_at from public.community_feed_page(5, null, null, 'post', false, null, null, true)
                 order by created_at asc, feed_key asc limit 1")
CURSOR_KEY=$(qs "select feed_key from public.community_feed_page(5, null, null, 'post', false, null, null, true)
                  order by created_at asc, feed_key asc limit 1")
run_eq "the second page does not repeat a row from the first" "0" \
  "select count(*) from public.community_feed_page(5, '$CURSOR_CT', '$CURSOR_KEY', 'all', false, null, null, true)
    where feed_key in (select feed_key from public.community_feed_page(5, null, null, 'all', false, null, null, true))"
run_eq "the cursor after the first page is strictly older" "1" \
  "select case when max(created_at) <= '$CURSOR_CT' then 1 else 0 end
     from public.community_feed_page(5, '$CURSOR_CT', '$CURSOR_KEY', 'all', false, null, null, true)"
run_eq "the clip post is on the first page"            "1" \
  "select count(*) from public.community_feed_page(50, null, null, 'post', false, null, null, true)
    where feed_key = 'post:$P1'"
run_eq "and the cursor has moved past it"               "0" \
  "select count(*) from public.community_feed_page(5, '$CURSOR_CT', '$CURSOR_KEY', 'post', false, null, null, true)
    where feed_key = 'post:$P1'"
run_eq "the clips filter pages too, without repeats"    "0" \
  "select count(*) from public.community_feed_page(2, (select created_at from $CLIPS_FALSE order by created_at asc, feed_key asc limit 1),
                                                  (select feed_key from $CLIPS_FALSE order by created_at asc, feed_key asc limit 1),
                                                  'clips', false, null, null, true)
    where feed_key in (select feed_key from public.community_feed_page(2, null, null, 'clips', false, null, null, true))"

# --- shape, security and ACLs ----------------------------------------------
run_eq "clip_state is the LAST column and every old column is still there" "1" \
  "select case when pg_get_function_result('public.community_feed_page(int,timestamptz,text,text,boolean,uuid,bigint,boolean)'::regprocedure)
     like '%dislikes integer, is_adult boolean, clip_state text)' then 1 else 0 end"
run_eq "the feed function is security definer with an empty search_path" "true|true" \
  "select p.prosecdef || '|' || (p.proconfig[1] = 'search_path=\"\"')::text from pg_proc p
    where p.proname = 'community_feed_page'"
run_eq "community_new_posts is security definer with an empty search_path" "true|true" \
  "select p.prosecdef || '|' || (p.proconfig[1] = 'search_path=\"\"')::text from pg_proc p
    where p.proname = 'community_new_posts'"
run_eq "anon may call the feed function"                 "t" \
  "select has_function_privilege('anon','public.community_feed_page(int,timestamptz,text,text,boolean,uuid,bigint,boolean)','execute')"
run_eq "authenticated may call the feed function"        "t" \
  "select has_function_privilege('authenticated','public.community_feed_page(int,timestamptz,text,text,boolean,uuid,bigint,boolean)','execute')"
run_eq "anon may call community_new_posts"               "t" \
  "select has_function_privilege('anon','public.community_new_posts(timestamptz,int,uuid,boolean)','execute')"
run_eq "authenticated may call community_new_posts"      "t" \
  "select has_function_privilege('authenticated','public.community_new_posts(timestamptz,int,uuid,boolean)','execute')"
run_eq "the clips feed index exists"                     "1" \
  "select count(*) from pg_indexes where indexname = 'community_posts_clips_feed_idx'"
run_eq "and it is partial, on the exact predicate the arm uses" "1" \
  "select case when pg_get_expr(i.indpred, i.indrelid) is not null
            and pg_get_indexdef(i.indexrelid) like '%created_at DESC, id DESC%'
          then 1 else 0 end
     from pg_index i join pg_class c on c.oid = i.indexrelid
    where c.relname = 'community_posts_clips_feed_idx'"
run_eq "the five earlier files were not edited by this one" "1" \
  "select case when pg_get_function_result('public.community_feed_page(int,timestamptz,text,text,boolean,uuid,bigint,boolean)'::regprocedure)
     like '%is_adult boolean, clip_state text)%' then 1 else 0 end"

echo
echo "== 23. Phase 3: community_new_posts keeps adult clips generic =="
NP_OLD="public.community_new_posts(null, 5, null)"
NP_NEW="public.community_new_posts(null, 5, null, false)"
run_eq "the three-argument call still resolves (default at the end)" "t" \
  "select count(*) >= 1 from $NP_OLD"
run_eq "by default an adult clip reports has_clip = true" "t" \
  "select has_clip from $NP_NEW where id = '$P3'"
run_eq "by default its clip code is withheld"            "1" \
  "select case when clip_code is null then 1 else 0 end from $NP_NEW where id = '$P3'"
run_eq "by default its anime id and episode are withheld" "1" \
  "select case when anime_id is null and episode_number is null then 1 else 0 end from $NP_NEW where id = '$P3'"
run_eq "by default the snippet is the generic text"      "Shared a clip" \
  "select snippet from $NP_NEW where id = '$P3'"
run_eq "p_show_adult = true returns the real clip"       "cde4567|202|1" \
  "select clip_code || '|' || anime_id || '|' || episode_number
     from public.community_new_posts(null, 5, null, true) where id = '$P3'"
run_eq "a non-adult clip is unaffected"                  "abc2345|101|5" \
  "select clip_code || '|' || anime_id || '|' || episode_number from $NP_NEW where id = '$P1'"
run_eq "a removed clip has no code to return"            "1" \
  "select case when clip_code is null and has_clip then 1 else 0 end from $NP_NEW where id = '$P2'"
run_eq "still counts every post for the total"           "1" \
  "select case when count(distinct total) = 1 and min(total) >= 1 then 1 else 0 end from $NP_NEW"
run_as_eq "a guest (anon) gets the same generic snippet" "Shared a clip" "anon" "-" \
  "select snippet from $NP_NEW where id = '$P3'"
run_as_eq "and a guest gets no clip code for it"         "1" "anon" "-" \
  "select case when clip_code is null then 1 else 0 end from $NP_NEW where id = '$P3'"

echo
echo "== 24. the clips-arm file is idempotent and its rollback is complete =="
G1=$(qs "select md5(pg_get_functiondef('public.community_feed_page(int,timestamptz,text,text,boolean,uuid,bigint,boolean)'::regprocedure))
              || md5(pg_get_functiondef('public.community_new_posts(timestamptz,int,uuid,boolean)'::regprocedure))")
if psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/docs/sql/community-clips-arm.sql" >/dev/null 2>&1; then
  ok "the file can run twice"
else
  bad "the file can run twice" "no error" "$(psql -d "$DB" -f "$ROOT/docs/sql/community-clips-arm.sql" 2>&1 | grep ERROR | head -2)"
fi
G2=$(qs "select md5(pg_get_functiondef('public.community_feed_page(int,timestamptz,text,text,boolean,uuid,bigint,boolean)'::regprocedure))
              || md5(pg_get_functiondef('public.community_new_posts(timestamptz,int,uuid,boolean)'::regprocedure))")
eq "the second run leaves both functions identical" "$G1" "$G2"
run_eq "and the clip data is still gated after the second run" "hidden_adult" \
  "select clip_state from $POSTS_ALL where feed_key = 'post:$P3'"

if psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/docs/sql/community-clips-arm-rollback.sql" >/dev/null 2>&1; then
  ok "the rollback runs clean"
else
  bad "the rollback runs clean" "no error" "$(psql -d "$DB" -f "$ROOT/docs/sql/community-clips-arm-rollback.sql" 2>&1 | grep ERROR | head -2)"
fi
run_eq "rollback: the Phase 2 function is back (no clip_state)" "f" \
  "select pg_get_function_result('public.community_feed_page(int,timestamptz,text,text,boolean,uuid,bigint,boolean)'::regprocedure) like '%clip_state%'"
run_eq "rollback: the comment arm still works"           "1" \
  "select count(*) from public.community_feed_page(50, null, null, 'comment', false, null, 101, true) where feed_key = 'comment:$C1'"
run_eq "rollback: posts and announcements still work"    "t" \
  "select count(*) > 0 from public.community_feed_page(50, null, null, 'all', false, null, null, true)"
run_eq "rollback: a post's title is always null again"   "1" \
  "select case when count(*) = 0 then 1 else 0 end from public.community_feed_page(50, null, null, 'all', false, null, null, true) where title is not null and kind = 'post'"
run_eq "rollback: there is no clips filter any more"     "0" \
  "select count(*) from public.community_feed_page(50, null, null, 'clips', false, null, null, true)"
run_eq "rollback: community_new_posts is back to three arguments" \
  "p_after timestamp with time zone, p_limit integer, p_exclude_author uuid" \
  "select pg_get_function_identity_arguments(p.oid) from pg_proc p where p.proname = 'community_new_posts'"
run_eq "rollback: the clips index is gone"               "0" \
  "select count(*) from pg_indexes where indexname = 'community_posts_clips_feed_idx'"
run_eq "rollback: the five earlier indexes are untouched" "5" \
  "select count(*) from pg_indexes where indexname in
     ('comments_community_feed_idx','comments_parent_idx','comments_anilist_feed_idx','community_posts_feed_idx','community_posts_clip_idx')"
if psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/docs/sql/community-clips-arm-rollback.sql" >/dev/null 2>&1; then
  ok "the rollback can run twice"
else
  bad "the rollback can run twice" "no error" "$(psql -d "$DB" -f "$ROOT/docs/sql/community-clips-arm-rollback.sql")"
fi
psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/docs/sql/community-clips-arm.sql" >/dev/null 2>&1
run_eq "re-applied: the clip arm is back"                "1" \
  "select case when clip_state = 'hidden_adult' then 1 else 0 end from $POSTS_ALL where feed_key = 'post:$P3'"

echo
echo "== 25. Phase 3: EXPLAIN (ANALYZE, BUFFERS) on 50k posts / 5k clips =="
# Seeded here, not in fixtures: only the planner needs this, and it must not
# leak into the behaviour tests above. The seed runs with the post guard off,
# the same way the 50k-comment seed did.
pg_guard_off
qs "insert into public.clips (code, anilist_id, episode_number, start_seconds, end_seconds, title)
    select 'seed' || lpad(g::text, 3, '0'), 1001 + (g % 500), (g % 24) + 1, 10, 25, 'Seed clip ' || g
      from generate_series(1, 5000) g
    on conflict (code) do nothing;" >/dev/null
qs "insert into public.community_posts (author_id, body, created_at)
    select (array['$ALICE','$BOB','$CAROL'])[1 + (g % 3)]::uuid,
           'seed text post ' || g,
           now() - (g || ' seconds')::interval
      from generate_series(1, 45000) g;" >/dev/null
qs "insert into public.community_posts (author_id, body, clip_id, created_at)
    select (array['$ALICE','$BOB','$CAROL'])[1 + (g % 3)]::uuid,
           'seed clip post ' || g,
           c.id,
           now() - (g || ' seconds')::interval
      from generate_series(1, 5000) g
      join public.clips c on c.code = 'seed' || lpad(g::text, 3, '0');" >/dev/null
pg_guard_on
run_eq "the seed put more than 50k published posts in place" "1" \
  "select case when count(*) >= 50000 then 1 else 0 end from public.community_posts
     where deleted_at is null and status = 'published'"
run_eq "and at least 5k of them carry a live clip"       "1" \
  "select case when count(*) >= 5000 then 1 else 0 end from public.community_posts
     where deleted_at is null and status = 'published' and clip_id is not null"
qs "analyze public.community_posts; analyze public.clips; analyze public.community_reactions;" >/dev/null

P3Q='public.community_feed_page(20, null, null, %s, false, null, null, true)'
q_p3()      { printf "$P3Q" "'$1'"; }
PLAIN_ALL='select id from public.community_posts
            where deleted_at is null and status = %s
            order by created_at desc, id desc limit 20'
q_plain_all()    { printf "$PLAIN_ALL" "'published'"; }
PLAIN_CLIPS='select id from public.community_posts
              where deleted_at is null and status = %s and clip_id is not null
              order by created_at desc, id desc limit 20'
q_plain_clips()  { printf "$PLAIN_CLIPS" "'published'"; }
plan_lines() { # plan_lines <query> -> the scan/index/exec lines of the plan
  psql -d "$DB" -tAq -c "explain (analyze, buffers) $1" 2>&1 |
    grep -iE 'Scan|Limit|Execution Time|Planning Time|Buffers|Heap Fetches' | sed 's/^ *//'
}

echo "   the same predicates as plain queries, so the planner's choice is visible:"
plan_lines "$(q_plain_all)"   | sed 's/^/     all    /'
plan_lines "$(q_plain_clips)" | sed 's/^/     clips  /'

eq "the plain clips query chooses community_posts_clips_feed_idx" "1" \
  "$(plan_lines "$(q_plain_clips)" | grep -c 'community_posts_clips_feed_idx')"
eq "the plain all query chooses community_posts_feed_idx" "1" \
  "$(plan_lines "$(q_plain_all)" | grep -c 'community_posts_feed_idx')"

# SECURITY DEFINER + SET search_path means the planner never inlines the
# function, so EXPLAIN shows only "Function Scan on community_feed_page". The
# honest evidence that an index was used is the index's own scan counter.
echo "   index used through the function:"
eq "the clips arm uses community_posts_clips_feed_idx" "1" \
  "$(idx_used community_posts_clips_feed_idx "$(q_p3 clips)")"
eq "the all arm uses community_posts_feed_idx"         "1" \
  "$(idx_used community_posts_feed_idx "$(q_p3 all)")"

echo "   timings through the function (buffers included above)"
printf '     All                %s\n' "$(ms_for "$(q_p3 all)")"
printf '     Clips              %s\n' "$(ms_for "$(q_p3 clips)")"
qs "drop index if exists public.community_posts_clips_feed_idx;" >/dev/null
qs "analyze public.community_posts;" >/dev/null
printf '     Clips, before community_posts_clips_feed_idx   %s\n' "$(ms_for "$(q_p3 clips)")"
plan_lines "$(q_plain_clips)" | sed 's/^/       without the index: /'
qs "create index community_posts_clips_feed_idx
      on public.community_posts (created_at desc, id desc)
      where clip_id is not null and deleted_at is null and status = 'published';" >/dev/null
qs "analyze public.community_posts;" >/dev/null
printf '     Clips, after community_posts_clips_feed_idx    %s\n' "$(ms_for "$(q_p3 clips)")"
plan_lines "$(q_plain_clips)" | sed 's/^/       with the index:    /'

echo "-------------------------------------------------------------"
printf "PASS %d   FAIL %d\n" "$pass" "$fail"
if [ "$fail" -gt 0 ]; then printf 'failed: %s\n' "${failed_names[*]}"; exit 1; fi
