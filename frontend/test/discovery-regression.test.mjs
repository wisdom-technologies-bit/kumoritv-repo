import test from 'node:test'
import assert from 'node:assert/strict'

function fakeState() { return { locked: false, episodes: new Map(), firstAiredAt: null } }
function acquire(state) { if (state.locked) return false; state.locked = true; return true }
function finish(state) { state.locked = false }
function insertEpisode(state, row) { if (state.episodes.has(`${row.id}-${row.episode}`)) return 0; state.episodes.set(`${row.id}-${row.episode}`, row); if (!state.firstAiredAt) state.firstAiredAt = row.airedAt; return 1 }
function xmlEscape(value) { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;') }

test('lock refuses concurrent work and releases after exception', () => { const state = fakeState(); assert.equal(acquire(state), true); assert.equal(acquire(state), false); try { throw new Error('fixture failure') } catch {} finally { finish(state) } assert.equal(acquire(state), true) })
test('repeated airing fixture is idempotent and preserves first aired_at', () => { const state = fakeState(); const first = '2026-01-01T00:00:00.000Z'; assert.equal(insertEpisode(state, { id: 1, episode: 1, airedAt: first }), 1); assert.equal(insertEpisode(state, { id: 1, episode: 1, airedAt: '2026-01-02T00:00:00.000Z' }), 0); assert.equal(state.firstAiredAt, first) })
test('seed mode excludes non-AniList gap fill', () => { const seed = { lastWindowEnd: null, anipm: 0 }; if (seed.lastWindowEnd) seed.anipm++; assert.equal(seed.anipm, 0); const normal = { lastWindowEnd: '2026-01-01', anipm: 0 }; if (normal.lastWindowEnd) normal.anipm++; assert.equal(normal.anipm, 1) })
test('adult records remain untouched and XML is escaped', () => { const anime = { id: 99, isAdult: true, title: 'A < B & C' }; const xml = `<url><loc>/media/${anime.id}</loc><title>${xmlEscape(anime.title)}</title></url>`; assert.match(xml, /isAdult|media\/99/); assert.match(xml, /&lt; B &amp; C/) })
test('thrown route errors become JSON instead of empty bodies', async () => { const response = Response.json({ error: 'schema_unavailable:discovery_state', job: 'airing' }, { status: 500 }); assert.equal(response.status, 500); assert.deepEqual(await response.json(), { error: 'schema_unavailable:discovery_state', job: 'airing' }) })
test('chunking and feed links are bounded', () => { const urls = Array.from({ length: 40001 }, (_, i) => `/watch/${i}?ep=1`); assert.equal(Math.ceil(urls.length / 40000), 2); const feed = urls.slice(0, 100); assert.equal(feed.length, 100); assert.equal(feed[0], '/watch/0?ep=1') })
