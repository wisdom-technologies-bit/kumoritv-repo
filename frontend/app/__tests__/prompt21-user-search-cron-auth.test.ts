// Prompt 21, part 5: the mention search route and the push cron's auth.
//
// The search route is called through its real GET handler with a stubbed client,
// so the auth check, the projection and the rate limit are the production ones.

import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "@/app/api/users/search/route";
import {
  USER_SEARCH_LIMIT,
  USER_SEARCH_RATE_LIMIT,
  __resetUserSearchRateLimitForTests,
  __setUserSearchClientForTests,
} from "@/app/lib/users/search";
import { requireCron } from "@/app/lib/cron/auth";
import { GET as pushCronGET } from "@/app/api/cron/push/route";

type ProfileRow = { username: string | null; avatar_url: string | null; id?: string; email?: string };

const PROFILES: ProfileRow[] = [
  { username: "frieren", avatar_url: "https://art.test/frieren.jpg", id: "p1", email: "frieren@example.test" },
  { username: "fern", avatar_url: null, id: "p2", email: "fern@example.test" },
  { username: "stark", avatar_url: "https://art.test/stark.jpg", id: "p3", email: "stark@example.test" },
  { username: "frieren_fan", avatar_url: null, id: "p4" },
  { username: null, avatar_url: null, id: "p5" },
];

function searchClient(options: { signedIn?: boolean; rows?: ProfileRow[] } = {}) {
  const queries: Array<{ table: string; filters: Array<[string, string]>; limit: number | null }> = [];

  return {
    queries,
    auth: {
      getUser: async () => ({
        data: { user: options.signedIn === false ? null : { id: "user-1" } },
      }),
    },
    from(table: string) {
      const entry: { table: string; filters: Array<[string, string]>; limit: number | null } = {
        table,
        filters: [],
        limit: null,
      };
      queries.push(entry);

      const builder: any = {
        select() {
          return builder;
        },
        not() {
          return builder;
        },
        ilike(column: string, value: string) {
          entry.filters.push([column, value]);
          return builder;
        },
        eq() {
          return builder;
        },
        order() {
          return builder;
        },
        limit(count: number) {
          entry.limit = count;
          return builder;
        },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          const rows = (options.rows ?? PROFILES)
            .filter((row) => typeof row.username === "string")
            .filter((row) => {
              const prefix = entry.filters[0]?.[1]?.replace(/%$/, "") ?? "";
              return (row.username as string).toLowerCase().startsWith(prefix.toLowerCase());
            })
            .slice(0, entry.limit ?? 6);

          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };

      return builder;
    },
  };
}

function callSearch(query: string, client = searchClient()) {
  __setUserSearchClientForTests(() => client as never);

  return GET(new Request(`https://kumoritv.top/api/users/search?q=${encodeURIComponent(query)}`));
}

test.afterEach(() => {
  __setUserSearchClientForTests(null);
  __resetUserSearchRateLimitForTests();
});

test("the search route refuses a signed-out caller", async () => {
  const response = await callSearch("fri", searchClient({ signedIn: false }));

  assert.equal(response.status, 401);
  const body = await response.json();
  assert.deepEqual(body.users, []);
});

test("the search route returns only usernames and avatars", async () => {
  const response = await callSearch("fri");
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.users, [
    { username: "frieren", avatar_url: "https://art.test/frieren.jpg" },
    { username: "frieren_fan", avatar_url: null },
  ]);

  // No emails, no ids, nothing else.
  const serialised = JSON.stringify(body);
  assert.equal(serialised.includes("example.test"), false);
  assert.equal(serialised.includes("p1"), false);
  for (const user of body.users) {
    assert.deepEqual(Object.keys(user).sort(), ["avatar_url", "username"]);
  }
});

test("the search route matches prefixes only, and asks for 6 rows", async () => {
  const client = searchClient();
  await callSearch("frieren", client);

  assert.equal(client.queries.length, 1);
  assert.equal(client.queries[0].table, "profiles");
  assert.deepEqual(client.queries[0].filters, [["username", "frieren%"]]);
  assert.equal(client.queries[0].limit, USER_SEARCH_LIMIT);
  assert.equal(USER_SEARCH_LIMIT, 6);
});

test("LIKE wildcards in the input are escaped", async () => {
  const client = searchClient();
  await callSearch("a%b_c", client);

  assert.deepEqual(client.queries[0].filters, [["username", "a\\%b\\_c%"]]);
});

test("a query shorter than one character returns nobody and asks nothing", async () => {
  const client = searchClient();
  const response = await callSearch("   ");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { users: [] });
  assert.equal(client.queries.length, 0);
});

test("a leading @ is ignored so the raw token still searches", async () => {
  const client = searchClient();
  await callSearch("@fern", client);

  assert.deepEqual(client.queries[0].filters, [["username", "fern%"]]);
});

test("the route rate-limits one user", async () => {
  const client = searchClient();

  for (let attempt = 0; attempt < USER_SEARCH_RATE_LIMIT; attempt += 1) {
    const response = await callSearch("fri", client);
    assert.equal(response.status, 200, `attempt ${attempt + 1} passes`);
  }

  const blocked = await callSearch("fri", client);
  assert.equal(blocked.status, 429);
  assert.deepEqual(await blocked.json(), { error: "rate_limited", users: [] });
});

test("a search database error is a 500 with an empty list, not a crash", async () => {
  __setUserSearchClientForTests(
    () =>
      ({
        auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
        from: () => {
          const builder: any = {
            select: () => builder,
            not: () => builder,
            ilike: () => builder,
            order: () => builder,
            limit: () => builder,
            then: (resolve: (value: unknown) => unknown) =>
              Promise.resolve({ data: null, error: { message: "boom" } }).then(resolve),
          };

          return builder;
        },
      }) as never,
  );

  const response = await GET(new Request("https://kumoritv.top/api/users/search?q=fri"));

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "search_failed", users: [] });
});

// ------------------------------------------------------------------ cron auth

test("requireCron rejects a missing secret", () => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "s3cret-value";

  try {
    const denied = requireCron(new Request("https://kumoritv.top/api/cron/push"));
    assert.ok(denied, "no header is refused");
    assert.equal(denied!.status, 401);
  } finally {
    process.env.CRON_SECRET = previous;
  }
});

test("requireCron rejects a wrong secret", () => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "s3cret-value";

  try {
    const wrongBearer = requireCron(
      new Request("https://kumoritv.top/api/cron/push", {
        headers: { authorization: "Bearer nope" },
      }),
    );
    assert.equal(wrongBearer!.status, 401);

    const wrongHeader = requireCron(
      new Request("https://kumoritv.top/api/cron/push", { headers: { "x-cron-secret": "nope" } }),
    );
    assert.equal(wrongHeader!.status, 401);
  } finally {
    process.env.CRON_SECRET = previous;
  }
});

test("requireCron accepts either header with the right secret", () => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "s3cret-value";

  try {
    assert.equal(
      requireCron(
        new Request("https://kumoritv.top/api/cron/push", {
          headers: { authorization: "Bearer s3cret-value" },
        }),
      ),
      null,
    );
    assert.equal(
      requireCron(
        new Request("https://kumoritv.top/api/cron/push", {
          headers: { "x-cron-secret": "s3cret-value" },
        }),
      ),
      null,
    );
  } finally {
    process.env.CRON_SECRET = previous;
  }
});

test("the push cron route itself answers 401 without the secret", async () => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "s3cret-value";

  try {
    const response = await pushCronGET(
      new Request("https://kumoritv.top/api/cron/push", { method: "GET" }),
    );

    assert.equal(response.status, 401);
    const body = await response.json();
    assert.equal(body.error, "UNAUTHORIZED");
    assert.equal(JSON.stringify(body).includes("s3cret-value"), false);
  } finally {
    process.env.CRON_SECRET = previous;
  }
});
