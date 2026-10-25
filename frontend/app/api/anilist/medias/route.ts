import { NextRequest, NextResponse } from 'next/server';
import { getMediaForThisFormat, getMediaInfo, getNewReleases, getReleasingByDaysRange, getReleasingThisWeek, getTrendingMedia, searchCatalog, searchMedias } from '@/app/lib/anilist/medias.server';

const enums = {
  type: ['ANIME', 'MANGA'], format: ['TV', 'TV_SHORT', 'MOVIE', 'OVA', 'ONA', 'SPECIAL', 'MUSIC'],
  sort: ['POPULARITY_DESC', 'TRENDING_DESC', 'SCORE_DESC', 'FAVOURITES_DESC', 'UPDATED_AT_DESC', 'TIME_DESC'],
  status: ['FINISHED', 'RELEASING', 'NOT_YET_RELEASED', 'CANCELLED', 'HIATUS'], season: ['WINTER', 'SPRING', 'SUMMER', 'FALL'],
} as const;
const bool = (value: string | null) => value === null ? undefined : value === 'true' ? true : value === 'false' ? false : null;
const integer = (value: string | null, min: number, max: number, fallback?: number) => value === null ? fallback : /^\d+$/.test(value) && +value >= min && +value <= max ? +value : null;

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const fn = p.get('fn');
  if (fn === 'mediaInfo') {
    const id = integer(p.get('id'), 1, 2147483647);
    if (id === null || id === undefined) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    return NextResponse.json({ result: await getMediaInfo({ id }) }, { headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600' } });
  }
  if (fn === 'search') {
    const query = (p.get('query') ?? p.get('q'))?.trim() || '';
    if (query.length < 2 || query.length > 80) return NextResponse.json({ error: 'Invalid query' }, { status: 400 });
    return NextResponse.json({ results: await searchMedias({ query, page: integer(p.get('page'), 1, 100, 1) || 1, perPage: integer(p.get('perPage'), 1, 50, 15) || 15 }) });
  }
  if (fn === 'searchCatalog') return NextResponse.json(await searchCatalog(Object.fromEntries(p.entries())));
  if (!['getNewReleases', 'getReleasingThisWeek', 'getReleasingByDaysRange', 'getTrendingMedia', 'getMediaForThisFormat'].includes(fn || '')) return NextResponse.json({ error: 'Invalid fn' }, { status: 400 });
  const pick = <K extends keyof typeof enums>(key: K) => { const value = p.get(key); return value === null ? undefined : (enums[key] as readonly string[]).includes(value) ? value : null; };
  const type = pick('type'); const format = pick('format'); const sort = pick('sort'); const status = pick('status'); const season = pick('season');
  const page = integer(p.get('page'), 1, 100, 1); const perPage = integer(p.get('perPage'), 1, 50, 20); const seasonYear = integer(p.get('seasonYear'), 1960, 2100); const days = integer(p.get('releasedOnLastXDays'), 0, 30);
  const showOnlyReleasesOnThisDate = bool(p.get('showOnlyReleasesOnThisDate'));
  if ([type, format, sort, status, season, page, perPage, seasonYear, days, showOnlyReleasesOnThisDate].some((value) => value === null)) return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 });
  const common = { type: type || 'ANIME', format: format || undefined, sort: sort || undefined, status: status || undefined, page: page || undefined, perPage: perPage || undefined, season: season || undefined, seasonYear: seasonYear || undefined, releasedOnLastXDays: days || undefined, showOnlyReleasesOnThisDate: showOnlyReleasesOnThisDate ?? undefined };
  try {
    let results: unknown[];
    if (fn === 'getNewReleases') results = await getNewReleases(common);
    else if (fn === 'getReleasingThisWeek') results = await getReleasingThisWeek(common);
    else if (fn === 'getReleasingByDaysRange') results = await getReleasingByDaysRange({ ...common, days: days || 0 });
    else if (fn === 'getTrendingMedia') results = await getTrendingMedia(common);
    else results = await getMediaForThisFormat(common);
    return NextResponse.json({ results }, { headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600' } });
  } catch { return NextResponse.json({ results: [] }, { headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600' } }); }
}
