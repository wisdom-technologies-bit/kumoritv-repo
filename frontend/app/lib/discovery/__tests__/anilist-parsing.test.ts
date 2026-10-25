import assert from "node:assert/strict";
import test from "node:test";
import { fetchAiringWindow, fetchMediaByIds, resolveAniListIds } from "../anilist";

const airing = { data: { Page: { pageInfo: { hasNextPage: true }, airingSchedules: [{ episode: 1, airingAt: 1792922400, media: { id: 190054, idMal: 61440, isAdult: false, format: "SPECIAL", status: "FINISHED", popularity: 10605, seasonYear: 2026, episodes: 3, title: { romaji: "Watashi no Shiawase na Kekkon Tokubetsu-hen", english: "My Happy Marriage Special Episodes" }, coverImage: { large: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx190054-8h0AuqQjwcCL.png" } } }, { episode: 2855, airingAt: 1792920600, media: { id: 2406, idMal: 2406, isAdult: false, format: "TV", status: "RELEASING", popularity: 2559, seasonYear: 1969, episodes: null, title: { romaji: "Sazae-san", english: null }, coverImage: { large: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx2406-nP8NIct9Sci3.jpg" } } }] } } };
const media = (key: string) => ({ data: { Page: { media: key === "empty" ? [] : [{ id: 190054, idMal: 61440, isAdult: true, title: { romaji: "Catalog item" } }] } } });
const originalFetch = globalThis.fetch;
function mock(body: unknown) { globalThis.fetch = (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch; }
test.afterEach(() => { globalThis.fetch = originalFetch; });

test("parses real airing data without treating HTTP 200 as an error", async () => { mock(airing); const result = await fetchAiringWindow(1, 2, 1); assert.equal(result.airingSchedules[0].media.id, 190054); assert.equal(result.pageInfo.hasNextPage, true); });
test("accepts empty media arrays for catalog and id mappings", async () => { mock(media("empty")); assert.deepEqual(await fetchMediaByIds([1]), []); mock(media("idMal_in")); assert.equal((await resolveAniListIds([1]))[0].id, 190054); });
test("reports GraphQL errors", async () => { mock({ errors: [{ message: "bad query" }] }); await assert.rejects(fetchAiringWindow(1, 2, 1), /anilist_200/); });
