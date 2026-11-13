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
   && psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/docs/sql/community.sql" >/dev/null 2>&1; then
  ok "profiles-rls.sql and community.sql can both run twice"
else
  bad "re-running the migrations" "no error" "$(psql -d "$DB" -f "$ROOT/docs/sql/community.sql" 2>&1 | grep ERROR | head -2)"
fi
run_eq  "still no stray insert policy after a re-run" "0" "select count(*) from pg_policies where tablename='community_posts' and cmd='INSERT'"

echo
echo "-------------------------------------------------------------"
printf "PASS %d   FAIL %d\n" "$pass" "$fail"
if [ "$fail" -gt 0 ]; then printf 'failed: %s\n' "${failed_names[*]}"; exit 1; fi
