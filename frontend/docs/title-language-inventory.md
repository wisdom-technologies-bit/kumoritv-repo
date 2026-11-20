# Title language inventory

Every place a title reaches a person, what it used before, and what it uses now.
"Fixed" means the surface goes through the one rule (`pickTitle` / `<AnimeTitle>`)
instead of reading a field by hand.

## The rule

`app/lib/titles/index.ts`:

- `pickTitle(titles, preference)` — preference -> English -> romaji -> native ->
  `userPreferred` (old saved rows only) -> `"Untitled"`. A native preference with
  no native string falls to romaji.
- `pickTitles(items, preference, getTitles)` — the same for lists.
- `alternativeTitle(titles, preference)` — the secondary line: native when the main
  title is romaji or English, romaji when the main title is native.
- `titleVariants(titles)` — all three, each already resolved.
- `matchesTitleQuery(titles, query, synonyms)` / `filterByTitleQuery` — search
  matches every name, never the display preference.
- `displayTitle(title)` — kept for STRINGS only (alt text, aria-label, template
  copy). English first, `userPreferred` last, `"Not Available"` when empty.

Visible titles render as `<AnimeTitle titles={…} />`: three spans, one shown by
CSS from `html[data-title-lang]`, which an inline script in the root layout sets
before paint. See "Caching" below for why.

## Inventory

| File | Surface | Server / client | Fixed |
| --- | --- | --- | --- |
| `app/page.tsx` | home sections | server | yes |
| `app/components/HomePage/HeroCarouselHomePage/index.tsx` | hero heading | client | yes |
| `app/components/HomePage/HeroCarouselHomePage/components/HeroListCarousel/index.tsx` | hero rail card, alt/title strings | client | yes (alt stays a string) |
| `app/components/HomePage/PopularMediaSection/index.tsx` | popular cards | client | yes |
| `app/components/HomePage/NavigationThroughMedias/index.tsx` | trending rails | client | yes |
| `app/components/HomePage/KeepWatchingSection/components/KeepWatchingEpisodeInfo/index.tsx` | keep-watching card | client | no: still `displayTitle` (string), see gaps |
| `app/components/MediaCards/MediaCard/index.tsx` | media card | client | yes |
| `app/components/MediaCards/MediaCard/variantClientSide.tsx` | card variant | client | yes |
| `app/components/MediaCards/MediaInfoExpandedWithCover/index.tsx` | expanded card | client | yes |
| `app/components/MediaCards/MediaCard/MediaActionOptionsButton/OptionsPanel/index.tsx` | options panel | client | yes |
| `app/components/Buttons/AddToFavourites/index.tsx` | favourite button, aria labels | client | yes |
| `app/components/Buttons/AddToNotification/index.tsx` | notify button, aria labels | client | yes |
| `app/components/Buttons/AddToList/index.tsx` | list button | client | strings only |
| `app/media/[id]/page.tsx` | media heading, metadata, JSON-LD | server | yes (metadata default) |
| `app/media/[id]/components/PageHeading/HeadingInfo/index.tsx` | heading, logo alt | server | yes |
| `app/media/[id]/components/PageHeading/HeadingInfo/MediaTitleOrLogo.tsx` | wordmark fallback | server | no: `displayTitle` string |
| `app/media/[id]/components/PageHeading/GridInfo/index.tsx` | facts strip aria-label | server | yes (string) |
| `app/media/[id]/components/MediaRelatedContainer/index.tsx` | related cards | server | yes |
| `app/media/[id]/components/MangaChaptersContainer/index.tsx` | chapter list titles | server | yes |
| `app/watch/[id]/page.tsx` | watch heading, related card, secondary line | server | yes |
| `app/watch/[id]/components/*` (episode list, next-episode labels) | episode rows | client | yes via card/heading |
| `app/read/[id]/page.tsx` | manga reader heading | server | yes |
| `app/my-lists/components/MediasContainer/index.tsx` | my-lists cards | client | yes |
| `app/favourites/components/PlaylistItemsResults/index.tsx` | favourites cards | client | yes |
| `app/layout/footer/components/navLinks/airingThisWeek.tsx` | airing rail | server | yes |
| `app/layout/header/components/AnimeNavListHover/index.tsx` | header hover list | client | no: `displayTitle` string |
| `app/layout/header/components/MangaNavListHover/index.tsx` | header hover list | client | yes |
| `app/layout/header/components/Notifications/index.tsx` | notification bell | client | yes (preference hook) |
| `app/layout/header/components/SearchFormContainer/components/SearchResultItemCard/index.tsx` | search suggestions | client | yes (preference hook) |
| `app/search/page.tsx` + `app/api/anilist/anilistMedias.ts` | search results and query | server + client | yes (AniList matches all names) |
| `app/lib/clips/browse-server.ts` | clip search columns | server | yes (`title`, `_english`, `_romaji`, `_native`) |
| `app/clip/[code]/page.tsx` | clip page/share text | server | no: `displayTitle` string |
| `app/community/*` (feed cards, airing rail, announcements) | community surfaces | server + client | no: titles come from SQL `coalesce(title_english, title)` |
| `app/api/push/*`, `app/lib/push/*` | push payload text | server | no: see gaps |
| `app/lib/seo/titles.ts` | `<title>`, OG, canonical | server | default by design |
| `app/lib/schedule/format.ts`, `ics.ts` | schedule rails, calendar feed | server | default by design |
| `app/lib/user-data/normalise.ts` | snapshot normaliser | shared | data layer (allow-listed) |
| `app/lib/anime-db/import.ts` | catalogue import | server | data layer (allow-listed) |

The static guard in `app/__tests__/prompt13-css-guards.test.ts` fails if a
component reads `.title.romaji` / `.title.english` directly; the data layer and
the helper itself are the only exceptions.

## Caching

A per-user cookie cannot change cached HTML, so visible titles are not rendered
from the cookie:

- **All three strings are in the HTML.** `<AnimeTitle>` emits one span per
  language. An inline script in `app/layout.tsx` sets
  `document.documentElement.dataset.titleLang` from the cookie (or localStorage
  for a guest) before paint, and `app/globals.css` reveals the matching span.
  No flash, no per-user cache key, no hydration state.
- **Strings that cannot be a span** (alt text, aria-label, share text, toast copy)
  use the cookie on the server or `useTitlePreference()` in a client component.
- **SEO stays on the default.** `<title>`, canonical, OpenGraph and JSON-LD use
  English, else romaji, because crawlers send no cookie. A crawler never sees a
  different title for the same URL.
- **Cloudflare.** No cache rule may vary HTML on `media_title_language`. If a rule
  caches HTML with `Cache Everything` and an explicit Edge Cache TTL, Cloudflare
  strips `Set-Cookie` and can serve one visitor's page to another: those rules
  must exclude `kumoritv.top/*` HTML or be scoped to `/assets/*`, `/api/proxy/*`
  and images only. The three-span markup makes a cached page correct for every
  visitor regardless, which is the point.

## Known gaps

1. **Push and bell text.** `notifications.title` is written by SQL as
   `coalesce(title_english, title)`, so a push built from that row is English even
   for a romaji reader. The bell now renders the row's title object through
   `pickTitle`, but the *push payload* still needs the recipient's preference at
   send time (join `profiles.title_language` in the fanout, or store all three
   columns). Not changed here: it touches the push pipeline.
2. **Community surfaces** (feed cards, announcements, airing rail) take the anime
   title from SQL `coalesce(a.title_english, a.title)`. Localising them means
   returning `title_romaji`/`title_native` from those views first.
3. **A handful of client components** still call `displayTitle()` for a string
   (keep-watching card, header hover list, clip page, media wordmark). They show
   the default rather than the preference.

## Screenshots

Playwright specs live in `test-harness/` and need a running app with a Supabase
project and provider access, which the sandbox does not have. The three-language
screenshots at 360 and 1280 (home, media, watch, search) were therefore not
produced here; the render tests assert the three spans instead.
