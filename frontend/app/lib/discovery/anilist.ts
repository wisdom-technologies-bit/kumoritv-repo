const ENDPOINT = "https://graphql.anilist.co";
const FIELDS = `id idMal isAdult format status popularity seasonYear episodes title{romaji english} coverImage{large}`;
const AIRING_QUERY = `query($page:Int,$from:Int,$to:Int){Page(page:$page,perPage:50){pageInfo{hasNextPage} airingSchedules(airingAt_greater:$from,airingAt_lesser:$to,sort:TIME_DESC){episode airingAt media{id idMal isAdult format status popularity seasonYear episodes title{romaji english} coverImage{large}}}}}`;
const RECENT_QUERY = `query($page:Int,$since:Int){Page(page:$page,perPage:50){pageInfo{hasNextPage} media(type:ANIME,sort:START_DATE_DESC,startDate_greater:$since,status_in:[RELEASING,FINISHED]){id idMal isAdult format status popularity seasonYear episodes title{romaji english} coverImage{large} startDate{year month day}}}}`;
const MEDIA_QUERY = `query($ids:[Int]){Page(page:1,perPage:50){media(id_in:$ids,type:ANIME){${FIELDS}}}}`;
const RESOLVE_QUERY = `query($ids:[Int]){Page(page:1,perPage:50){media(idMal_in:$ids,type:ANIME){id idMal}}}`;
let requestTimes: number[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function integer(value: number, name: string) { if (!Number.isInteger(value) || !Number.isFinite(value)) throw new Error(`invalid_${name}`); return value; }
async function gql(query: string, variables: Record<string, unknown>, retries = 3): Promise<any> {
  while (requestTimes[0] && requestTimes[0] < Date.now() - 60000) requestTimes.shift();
  if (requestTimes.length >= 80) await sleep(Math.max(0, 60000 - (Date.now() - requestTimes[0]) + 10));
  requestTimes.push(Date.now());
  const response = await fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, variables }), cache: "no-store" });
  const body = (await response.text()).slice(0, 500);
  if (response.status === 429 && retries > 0) { const retry = Number(response.headers.get("retry-after") || response.headers.get("x-ratelimit-reset") || 1); await sleep(Math.min(60000, Math.max(300, retry * 1000))); return gql(query, variables, retries - 1); }
  if (!response.ok) throw new Error(`anilist_${response.status}: ${body}`);
  let json: any; try { json = JSON.parse(body); } catch { throw new Error(`anilist_${response.status}: ${body}`); }
  if (json.errors?.length) throw new Error(`anilist_${response.status}: ${body}`);
  return json.data;
}
export async function fetchAiringWindow(fromUnix: number, toUnix: number, page: number) { integer(fromUnix, "from"); integer(toUnix, "to"); integer(page, "page"); if (fromUnix >= toUnix) throw new Error("invalid_airing_window"); return (await gql(AIRING_QUERY, { page, from: fromUnix, to: toUnix })).Page; }
export async function fetchRecentStarts(sinceYYYYMMDD: number, page: number) { integer(sinceYYYYMMDD, "since"); integer(page, "page"); return (await gql(RECENT_QUERY, { page, since: sinceYYYYMMDD })).Page; }
export async function fetchMediaByIds(ids: number[]) { const out: any[] = []; for (let i = 0; i < ids.length; i += 50) { const chunk = ids.slice(i, i + 50); chunk.forEach((id) => integer(id, "id")); const page = await gql(MEDIA_QUERY, { ids: chunk }); out.push(...(page.Page.media || [])); } return out; }
export async function resolveAniListIds(malIds: number[]) { const out: any[] = []; for (let i = 0; i < malIds.length; i += 50) { const ids = malIds.slice(i, i + 50); ids.forEach((id) => integer(id, "mal_id")); const data = await gql(RESOLVE_QUERY, { ids }); out.push(...(data.Page.media || [])); if (i + 50 < malIds.length) await sleep(300); } return out; }
