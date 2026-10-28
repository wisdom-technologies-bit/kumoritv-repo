// Parsing for the `?genre=` search parameter.
//
// Every link on the site uses the original backend's bracket format
// (`/search?genre=[adventure]`, `/search?genre=[action-comedy]`,
// `/search?type=tv&genre=[slice-of-life]`), while the media page genre chips
// lower-case the AniList genre name (`slice of life`, `mahou shoujo`). AniList
// expects canonical, case-sensitive genre names (and treats demographics as
// tags), so every accepted spelling has to resolve to those names here.
//
// The separator inside brackets is "-" and several slugs contain hyphens, so the
// body is matched greedily against the known slug list (longest slug first)
// instead of being split blindly on "-".

export type ParsedGenreParam = {
  genres: string[];
  tags: string[];
};

type Definition = {
  /** Canonical slug used when the sidebar writes the parameter back out. */
  slug: string;
  /** Canonical name AniList expects. */
  name: string;
  /** Other spellings accepted for the same value. */
  aliases?: string[];
};

type DefinitionWithKind = Definition & { kind: 'genre' | 'tag' };

// AniList genres. The slug is what the site links use; the name is what AniList
// expects back (case-sensitive).
const GENRE_DEFINITIONS: Definition[] = [
  { slug: 'action', name: 'Action' },
  { slug: 'adventure', name: 'Adventure' },
  { slug: 'comedy', name: 'Comedy' },
  { slug: 'drama', name: 'Drama' },
  { slug: 'ecchi', name: 'Ecchi' },
  { slug: 'fantasy', name: 'Fantasy' },
  { slug: 'hentai', name: 'Hentai' },
  { slug: 'horror', name: 'Horror' },
  { slug: 'mahou', name: 'Mahou Shoujo', aliases: ['mahou-shoujo'] },
  { slug: 'mecha', name: 'Mecha' },
  { slug: 'music', name: 'Music' },
  { slug: 'mystery', name: 'Mystery' },
  { slug: 'psychological', name: 'Psychological' },
  { slug: 'romance', name: 'Romance' },
  { slug: 'sci-fi', name: 'Sci-Fi', aliases: ['scifi'] },
  { slug: 'slice-of-life', name: 'Slice of Life' },
  { slug: 'sports', name: 'Sports' },
  { slug: 'supernatural', name: 'Supernatural' },
  { slug: 'thriller', name: 'Thriller' },
];

// Demographics are AniList TAGS, not genres, so they travel in `tag_in`.
const TAG_DEFINITIONS: Definition[] = [
  { slug: 'shoujo', name: 'Shoujo' },
  { slug: 'shounen', name: 'Shounen' },
  { slug: 'seinen', name: 'Seinen' },
  { slug: 'josei', name: 'Josei' },
  { slug: 'kids', name: 'Kids' },
];

const DEFINITIONS: DefinitionWithKind[] = [
  ...GENRE_DEFINITIONS.map((definition) => ({ ...definition, kind: 'genre' as const })),
  ...TAG_DEFINITIONS.map((definition) => ({ ...definition, kind: 'tag' as const })),
];

/** Reusable option list (slug -> label) for genre pickers. */
export const GENRE_OPTIONS = GENRE_DEFINITIONS.map(({ slug, name }) => ({ slug, label: name }));

/** Reusable option list (slug -> label) for demographics, which are AniList tags. */
export const DEMOGRAPHIC_TAG_OPTIONS = TAG_DEFINITIONS.map(({ slug, name }) => ({ slug, label: name }));

// Every accepted spelling -> its definition, longest first so a greedy walk takes
// "slice-of-life" before "life" and "mahou-shoujo" before "mahou".
const SLUG_INDEX = new Map<string, DefinitionWithKind>();

for (const definition of DEFINITIONS) {
  for (const slug of [definition.slug, ...(definition.aliases || [])]) {
    SLUG_INDEX.set(slug, definition);
  }
}

const SLUGS_LONGEST_FIRST = Array.from(SLUG_INDEX.keys()).sort((a, b) => b.length - a.length);

/**
 * Lower-cases and flattens one parameter value into a slug-ish string: brackets,
 * quotes, spaces, underscores and commas all become separators, so "[Slice of
 * Life]" and "slice-of-life" arrive at the same text. URL-encoded input
 * ("%5Badventure%5D") is decoded first.
 */
function normalizeParamValue(value: string): string {
  let decoded = value;

  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Malformed escapes: fall back to the raw value.
    decoded = value;
  }

  return decoded
    .toLowerCase()
    .replace(/[\s_,;|+/]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Walks one normalized value and returns the known slugs it contains, in order. */
function readSlugs(normalized: string): string[] {
  const slugs: string[] = [];
  let rest = normalized;

  while (rest.length > 0) {
    const match = SLUGS_LONGEST_FIRST.find((slug) => rest === slug || rest.startsWith(`${slug}-`));

    if (match) {
      slugs.push(match);
      rest = rest.slice(match.length);
      rest = rest.startsWith('-') ? rest.slice(1) : rest;
      continue;
    }

    // Unknown token: drop up to the next separator and keep looking, so
    // "[unknown-comedy]" still resolves to Comedy.
    const nextSeparator = rest.indexOf('-');

    if (nextSeparator === -1) break;

    rest = rest.slice(nextSeparator + 1);
  }

  return slugs;
}

function matchDefinitions(value: string | string[] | undefined): DefinitionWithKind[] {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  const found: DefinitionWithKind[] = [];

  for (const entry of values) {
    if (typeof entry !== 'string') continue;

    const normalized = normalizeParamValue(entry);

    if (!normalized) continue;

    for (const slug of readSlugs(normalized)) {
      const definition = SLUG_INDEX.get(slug);

      if (definition && !found.includes(definition)) found.push(definition);
    }
  }

  return found;
}

/**
 * Parses the `?genre=` parameter in every format the site produces.
 * Unknown values are ignored, duplicates are removed and order is kept.
 */
export function parseGenreParam(value: string | string[] | undefined): ParsedGenreParam {
  const parsed: ParsedGenreParam = { genres: [], tags: [] };

  for (const definition of matchDefinitions(value)) {
    const list = definition.kind === 'tag' ? parsed.tags : parsed.genres;

    if (!list.includes(definition.name)) list.push(definition.name);
  }

  return parsed;
}

/** The same parse, as canonical slugs: what the sidebar toggles on and off. */
export function parseGenreSlugs(value: string | string[] | undefined): string[] {
  return matchDefinitions(value).map((definition) => definition.slug);
}

/** Builds the bracket format ("[a-b-c]") the site links use; "" when empty. */
export function serializeGenreParam(slugs: string[]): string {
  const found: DefinitionWithKind[] = [];

  for (const slug of slugs) {
    if (typeof slug !== 'string') continue;

    const normalized = normalizeParamValue(slug);

    if (!normalized) continue;

    for (const matched of readSlugs(normalized)) {
      const definition = SLUG_INDEX.get(matched);

      if (definition && !found.includes(definition)) found.push(definition);
    }
  }

  if (found.length === 0) return '';

  return `[${found.map((definition) => definition.slug).join('-')}]`;
}
