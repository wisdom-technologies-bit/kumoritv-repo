const ENDPOINT = "https://graphql.anilist.co";
const FIELDS = `id idMal isAdult format status popularity seasonYear episodes title{romaji english} coverImage{large}`;
let requestTimes: number[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function gql(query: string, variables: Record<string, unknown>, retries = 3): Promise<any> {
  while (requestTimes[0] && requestTimes[0] < Date.now() - 60000) requestTimes.shift();
  if (requestTimes.length >= 80) await sleep(Math.max(0, 60000 - (Date.now() - requestTimes[0]) + 10));
  requestTimes.push(Date.now());
  const response = await fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, variables }), cache: "no-store" });
  if (response.status === 429 && retries > 0) { const retry = Number(response.headers.get("retry-after") || response.headers.get("x-ratelimit-reset") || 1); await sleep(Math.min(60000, Math.max(300, retry * 1000))); return gql(query, variables, retries - 1); }
  if (!response.ok) throw new Error(`anilist_${response.status}`);
  const json = await response.json(); if (json.errors?.length) throw new Error(json.errors[0].message); return json.data;
}
const query = (extra: string) => `query($page:Int,$from:Int,$to:Int,$since:Int,$ids:[Int]){${extra}}`;
export async function fetchAiringWindow(fromUnix: number, toUnix: number, page: number) { return (await gql(query(`Page(page:$page,perPage:50){pageInfo{hasNextPage} airingSchedules(airingAt_greater:$from,airingAt_lesser:$to,sort:TIME_DESC){episode airingAt media{${FIELDS}}}}`), { page, from: fromUnix, to: toUnix })).Page; }
export async function fetchRecentStarts(sinceYYYYMMDD: number, page: number) { return (await gql(query(`Page(page:$page,perPage:50){pageInfo{hasNextPage} media(type:ANIME,sort:START_DATE_DESC,startDate_greater:$since,status_in:[RELEASING,FINISHED]){${FIELDS} startDate{year month day}}}`), { page, since: sinceYYYYMMDD })).Page; }
export async function fetchMediaByIds(ids: number[]) { if (!ids.length) return []; return (await gql(query(`Page(page:$page,perPage:50){media(id_in:$ids,type:ANIME){${FIELDS}}}`), { page: 1, ids })).Page.media || []; }
export async function resolveAniListIds(malIds: number[]) { const out: any[] = []; for (let i = 0; i < malIds.length; i += 50) { const ids = malIds.slice(i, i + 50); const data = await gql(query(`Page(page:$page,perPage:50){media(idMal_in:$ids,type:ANIME){id idMal}}`), { page: 1, ids }); out.push(...(data.Page.media || [])); if (i + 50 < malIds.length) await sleep(300); } return out; }
