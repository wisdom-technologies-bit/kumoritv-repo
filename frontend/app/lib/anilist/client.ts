export class AniListUnavailableError extends Error {
  constructor(message = 'AniList is unavailable') {
    super(message);
    this.name = 'AniListUnavailableError';
  }
}

/**
 * AniList is rate limiting us (HTTP 429, or our own 24-per-minute slot window is
 * full). It is NOT a statement about the media: the same id will succeed later,
 * so callers must never treat it as "not found" or burn a retry attempt on it.
 */
export class AniListRateLimitedError extends AniListUnavailableError {
  constructor(message = 'AniList rate limited', public retryAfterMs = 60000) {
    super(message);
    this.name = 'AniListRateLimitedError';
  }
}

/** The media really does not exist on AniList (a 404, or `Media: null`). */
export class AniListNotFoundError extends AniListUnavailableError {
  constructor(message = 'AniList media not found') {
    super(message);
    this.name = 'AniListNotFoundError';
  }
}

/** AniList answers "Too Many Requests" in the GraphQL body as well as over HTTP. */
function isRateLimitBody(body: string) {
  return /too many requests|rate.?limit|429/i.test(body);
}

const requestTimes: number[] = [];
const lastGoodResults = new Map<string, unknown>();

function cacheKey(query: string, variables: Record<string, unknown>) {
  return `${query}:${JSON.stringify(variables, Object.keys(variables).sort())}`;
}

function stale<T>(key: string): T | undefined {
  return lastGoodResults.get(key) as T | undefined;
}

function normalizeTitles(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach(normalizeTitles);
    return;
  }
  const object = value as Record<string, unknown>;
  const title = object.title;
  if (title && typeof title === 'object') {
    const titleObject = title as Record<string, unknown>;
    titleObject.userPreferred = titleObject.english || titleObject.romaji || titleObject.native;
  }
  Object.values(object).forEach(normalizeTitles);
}

const SLOT_WINDOW_MS = 60000;
const SLOTS_PER_WINDOW = 24;

/** Returns 0 when a slot was taken, otherwise how long to wait for the next one. */
function acquireSlot(now = Date.now()): number {
  while (requestTimes[0] && now - requestTimes[0] >= SLOT_WINDOW_MS) requestTimes.shift();
  if (requestTimes.length >= SLOTS_PER_WINDOW) {
    return Math.max(250, SLOT_WINDOW_MS - (now - (requestTimes[0] as number)) + 10);
  }
  requestTimes.push(now);
  return 0;
}

// One warning per run (a 60s window) instead of one per failed media.
let lastRateLimitLog = 0;
function logRateLimitOnce(message: string) {
  const now = Date.now();
  if (now - lastRateLimitLog < SLOT_WINDOW_MS) return;
  lastRateLimitLog = now;
  console.warn(`[AniList] rate limited: ${message}`);
}

export async function anilistFetch<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const key = cacheKey(query, variables);
  const waited = acquireSlot();
  if (waited > 0) {
    const cached = stale<T>(key);
    if (cached !== undefined) return cached;
    // Distinguishable on purpose: this is OUR throttle, not a missing media.
    logRateLimitOnce(`request throttle is full, retry in ${waited}ms`);
    throw new AniListRateLimitedError('AniList rate limited (local throttle)', waited);
  }

  const endpoint = process.env.ANILIST_API_URL || 'https://graphql.anilist.co';
  let response: Response;
  let retried429 = false;
  let lastRetryAfterMs = 0;
  try {
    while (true) {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(10000),
      });
      if (response.status !== 429 || retried429) break;
      const retryAfter = Number(response.headers.get('Retry-After') || 0);
      lastRetryAfterMs = Math.max(0, retryAfter) * 1000;
      logRateLimitOnce(`HTTP 429${retryAfter ? `; retry-after=${retryAfter}s` : ''}`);
      // Honour Retry-After when the server tells us a short wait; a long one is
      // reported to the caller instead of blocking a cron run on it.
      if (retryAfter > 3) break;
      retried429 = true;
      await new Promise((resolve) => setTimeout(resolve, Math.max(250, retryAfter * 1000)));
      if (acquireSlot() > 0) break;
    }
    if (response.status === 429) {
      throw new AniListRateLimitedError('AniList rate limited (HTTP 429)', lastRetryAfterMs || 60000);
    }
    if (!response.ok) throw new AniListUnavailableError(`AniList HTTP ${response.status}`);
    const payload = (await response.json()) as { data?: T; errors?: unknown[] };
    if (payload.errors?.length || payload.data === undefined) {
      // "Too Many Requests" arrives as a GraphQL error, not only as HTTP 429.
      if (isRateLimitBody(JSON.stringify(payload.errors ?? []))) {
        throw new AniListRateLimitedError('AniList rate limited (GraphQL)', 60000);
      }
      throw new AniListUnavailableError('AniList GraphQL error');
    }
    normalizeTitles(payload.data);
    lastGoodResults.set(key, payload.data);
    return payload.data;
  } catch (error) {
    const cached = stale<T>(key);
    if (cached !== undefined) return cached;
    if (error instanceof AniListUnavailableError) throw error;
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new AniListRateLimitedError('AniList request timed out', 60000);
    }
    throw new AniListUnavailableError(error instanceof Error ? error.message : 'AniList request failed');
  }
}
