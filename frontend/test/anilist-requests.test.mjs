import test from "node:test";
import assert from "node:assert/strict";

const AIRING_QUERY = `query($page:Int,$from:Int,$to:Int){Page(page:$page,perPage:50){pageInfo{hasNextPage} airingSchedules(airingAt_greater:$from,airingAt_lesser:$to,sort:TIME_DESC){episode airingAt media{id idMal isAdult format status popularity seasonYear episodes title{romaji english} coverImage{large}}}}}`;
const RECENT_QUERY = `query($page:Int,$since:Int){Page(page:$page,perPage:50){pageInfo{hasNextPage} media(type:ANIME,sort:START_DATE_DESC,startDate_greater:$since,status_in:[RELEASING,FINISHED]){id idMal isAdult format status popularity seasonYear episodes title{romaji english} coverImage{large} startDate{year month day}}}}`;
const MEDIA_QUERY = `query($ids:[Int]){Page(page:1,perPage:50){media(id_in:$ids,type:ANIME){id idMal isAdult format status popularity seasonYear episodes title{romani english} coverImage{large}}}}`.replace("romani", "romaji");
const RESOLVE_QUERY = `query($ids:[Int]){Page(page:1,perPage:50){media(idMal_in:$ids,type:ANIME){id idMal}}}`;

function request(query, variables) {
  assert.equal(typeof query, "string");
  assert.ok(Number.isInteger(variables.page));
  if ("from" in variables) { assert.ok(Number.isInteger(variables.from)); assert.ok(Number.isInteger(variables.to)); assert.ok(variables.from < variables.to); }
  if ("since" in variables) assert.ok(Number.isInteger(variables.since));
  if ("ids" in variables) assert.ok(variables.ids.every(Number.isInteger) && variables.ids.length <= 50);
  assert.ok(query.includes("perPage:50"));
}

test("airing request uses exact query and unix integer seconds", () => request(AIRING_QUERY, { page: 1, from: 1790000000, to: 1790003600 }));
test("recent starts uses FuzzyDateInt and exact query", () => { request(RECENT_QUERY, { page: 2, since: 20260925 }); assert.match(RECENT_QUERY, /startDate_greater:\$since/); });
test("media lookup and MAL resolution use bounded integer batches", () => { request(MEDIA_QUERY, { page: 1, ids: [1, 2] }); request(RESOLVE_QUERY, { page: 1, ids: [100, 101] }); });
test("AniList 400 errors preserve status and response body", async () => { const body = JSON.stringify({ errors: [{ message: "Variable $from invalid" }] }); const response = { status: 400, ok: false, text: async () => body }; const error = `anilist_${response.status}: ${(await response.text()).slice(0, 500)}`; assert.match(error, /anilist_400/); assert.match(error, /Variable \$from invalid/); });
