import assert from "node:assert/strict";
import test from "node:test";
import {
  __setAdminClientForTests,
  mangadexGet,
  resolveMangaDexId,
} from "../mangadex";

// --------------------------------------------------------------- fake supabase

class FakeAdminClient {
  sources: Record<string, Record<string, unknown>> = {};
  upserts: Record<string, unknown>[] = [];

  from(table: string) {
    const client = this;
    return {
      select() {
        return {
          eq(_column: string, value: number) {
            return {
              async maybeSingle() {
                if (table !== "manga_sources") return { data: null, error: null };
                return { data: client.sources[String(value)] ?? null, error: null };
              },
            };
          },
        };
      },
      async upsert(row: Record<string, unknown>) {
        if (table === "manga_sources") {
          client.sources[String(row.anilist_id)] = row;
          client.upserts.push(row);
        }
        return { error: null };
      },
    };
  }
}

// ------------------------------------------------------------------ fake fetch

const originalFetch = globalThis.fetch;
const originalConsoleError = console.error;

type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response> | undefined;

let handler: Handler = () => undefined;
let inits: { url: string; init?: RequestInit }[] = [];

function installFetch(next: Handler) {
  handler = next;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    inits.push({ url: url.toString(), init });
    const response = await handler(url, init);
    if (!response) throw new Error(`unexpected fetch: ${url.toString()}`);
    return response;
  }) as typeof fetch;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const FRIEREN_TITLES = ["Sousou no Frieren", "Frieren"];

test.beforeEach(() => {
  inits = [];
  console.error = () => {};
  installFetch(() => {
    throw new TypeError("network down");
  });
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  console.error = originalConsoleError;
  __setAdminClientForTests(undefined);
});

// ------------------------------------------------------------------- part C.1

test("every search failing writes nothing and does not cache a 24h not-found block", async () => {
  const admin = new FakeAdminClient();
  __setAdminClientForTests(admin);

  const first = await resolveMangaDexId(154587, FRIEREN_TITLES);

  assert.equal(first, null);
  assert.equal(admin.upserts.length, 0, "no manga_sources row may be written");
  assert.equal(admin.sources["154587"], undefined);

  // Second visit: a working MangaDex must be able to resolve straight away,
  // which is only possible because the failure was not cached.
  installFetch((url) => {
    if (url.pathname === "/manga") {
      return json({
        data: [
          {
            id: "manga-frieren",
            attributes: { title: { en: "Frieren: Beyond Journey's End" }, links: { al: "154587" } },
          },
        ],
      });
    }
    return json({ data: [] });
  });

  const second = await resolveMangaDexId(154587, FRIEREN_TITLES);

  assert.equal(second, "manga-frieren");
  assert.equal(admin.upserts.length, 1);
  assert.equal(admin.upserts[0].not_found, false);
});

test("a rate-limited search that never recovers also writes nothing", async () => {
  const admin = new FakeAdminClient();
  __setAdminClientForTests(admin);

  installFetch(() => json({ result: "error" }, 429));

  const result = await resolveMangaDexId(154587, ["Sousou no Frieren"]);

  assert.equal(result, null);
  assert.equal(admin.upserts.length, 0, "429s are not proof the manga is missing");
});

test("one successful search with no match records not_found", async () => {
  const admin = new FakeAdminClient();
  __setAdminClientForTests(admin);

  let answered = 0;
  installFetch((url) => {
    if (url.pathname !== "/manga") return json({ data: [] });
    answered += 1;
    // Only the first title search answers; the rest fail.
    if (answered === 1) return json({ data: [{ id: "other-manga", attributes: { title: { en: "Something Else" } } }] });
    throw new TypeError("network down");
  });

  const result = await resolveMangaDexId(154587, FRIEREN_TITLES);

  assert.equal(result, null);
  assert.equal(admin.upserts.length, 1);
  assert.equal(admin.sources["154587"].not_found, true);

  // The cache now short-circuits the next visit.
  inits = [];
  const again = await resolveMangaDexId(154587, FRIEREN_TITLES);

  assert.equal(again, null);
  assert.equal(inits.length, 0, "a fresh not-found row is served from the cache");
});

test("a successful search that matches records the mangadex id", async () => {
  const admin = new FakeAdminClient();
  __setAdminClientForTests(admin);

  installFetch(() =>
    json({
      data: [
        {
          id: "manga-frieren",
          attributes: { title: { en: "Frieren" }, links: { al: "154587" } },
        },
      ],
    }),
  );

  const result = await resolveMangaDexId(154587, FRIEREN_TITLES);

  assert.equal(result, "manga-frieren");
  assert.equal(admin.sources["154587"].mangadex_id, "manga-frieren");
  assert.equal(admin.sources["154587"].not_found, false);
});

// ------------------------------------------------------------------- part C.2

test("mangadexGet with revalidate sends next.revalidate and no cache override", async () => {
  installFetch(() => json({ ok: true }));

  await mangadexGet("/manga", { title: "frieren" }, { revalidate: 3600 });

  assert.equal(inits.length, 1);
  const init = inits[0].init as RequestInit & { next?: { revalidate: number } };

  assert.deepEqual(init.next, { revalidate: 3600 });
  assert.equal(init.cache, undefined, "cache and next.revalidate must not be combined");
});

test("mangadexGet without revalidate uses no-store", async () => {
  installFetch(() => json({ ok: true }));

  await mangadexGet("/manga", { title: "frieren" });

  const init = inits[0].init as RequestInit & { next?: { revalidate: number } };

  assert.equal(init.cache, "no-store");
  assert.equal(init.next, undefined);
});

test("mangadexGet retries a 5xx once and then succeeds", async () => {
  let calls = 0;
  installFetch(() => {
    calls += 1;
    return calls === 1 ? json({ error: "boom" }, 500) : json({ ok: true });
  });

  const result = await mangadexGet<{ ok: boolean }>("/manga", {}, { revalidate: 60 });

  assert.equal(calls, 2);
  assert.equal(result.ok, true);
});
