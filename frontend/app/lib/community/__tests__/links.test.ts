// Prompt 38B: the six deep links from the plan (section 5.3), plus the check
// that app/lib/community/links.ts and public.comment_link() agree.
import assert from "node:assert/strict";
import test from "node:test";
import { announcementUrl, commentUrl, postUrl } from "../links";

const POST = "10000000-0000-0000-0000-000000000001";
const ANNOUNCEMENT = "20000000-0000-0000-0000-000000000001";
const COMMENT = "30000000-0000-0000-0000-000000000001";

test("post and announcement paths", () => {
  assert.equal(postUrl(POST), `/community/post/${POST}`);
  assert.equal(announcementUrl(ANNOUNCEMENT), `/community/announcements/${ANNOUNCEMENT}`);
});

test("post comments deep-link to their own post", () => {
  assert.equal(
    commentUrl({ target_type: "post", id: COMMENT, post_id: POST }),
    `/community/post/${POST}#comment-${COMMENT}`,
  );
});

test("announcement comments deep-link to their own announcement", () => {
  assert.equal(
    commentUrl({ target_type: "announcement", id: COMMENT, announcement_id: ANNOUNCEMENT }),
    `/community/announcements/${ANNOUNCEMENT}#comment-${COMMENT}`,
  );
});

test("anime comments keep the pre-38B media link", () => {
  assert.equal(
    commentUrl({ target_type: "anime", id: COMMENT, anilist_id: 21, episode_number: null }),
    `/media/21#comment-${COMMENT}`,
  );
});

test("episode comments keep the pre-38B watch link", () => {
  assert.equal(
    commentUrl({ target_type: "anime", id: COMMENT, anilist_id: 21, episode_number: 7 }),
    `/watch/21?ep=7#comment-${COMMENT}`,
  );
});

// --- Prompt 38E: comment rows in the feed reuse these exact strings ---------
// public.comment_link(comments) is the other side of this contract: the feed's
// target_url column is produced by it, and the card links to target_url. A
// phone-sized episode number and a reply id are the two cases the feed adds.

test("big episode numbers are not rounded or reformatted", () => {
  assert.equal(
    commentUrl({ target_type: "anime", id: COMMENT, anilist_id: 16498, episode_number: 1234 }),
    `/watch/16498?ep=1234#comment-${COMMENT}`,
  );
});

test("a reply deep-links to its own id, on its episode", () => {
  const reply = "40000000-0000-0000-0000-000000000009";
  assert.equal(
    commentUrl({ target_type: "anime", id: reply, anilist_id: 21, episode_number: 3 }),
    `/watch/21?ep=3#comment-${reply}`,
  );
});

test("an anime title with no episode is a media page, never ep=null", () => {
  const url = commentUrl({ target_type: "anime", id: COMMENT, anilist_id: 21, episode_number: null });
  assert.equal(url, `/media/21#comment-${COMMENT}`);
  assert.ok(!url.includes("ep=null"));
  assert.ok(!url.includes("ep=undefined"));
});
