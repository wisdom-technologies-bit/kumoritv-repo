// Configuration and rollout: read at request time, off unless switched on.

import assert from "node:assert/strict";
import test from "node:test";
import {
  aniBucket,
  aniConfig,
  aniReady,
  aniRolloutAllows,
} from "@/app/lib/ani/config";

const withEnv = (values: Record<string, string | undefined>) => {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(values)) {
    saved[key] = process.env[key];
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  return () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
};

const BASE_ENV = {
  ANI_API_BASE_URL: undefined,
  ANI_API_KEY: undefined,
  ANI_PROVIDER_ENABLED: undefined,
  ANI_PROVIDER_PERCENT: undefined,
  ANI_DUB_ENABLED: undefined,
  ANI_API_TIMEOUT_MS: undefined,
  ANI_MAX_CONCURRENCY: undefined,
  ANI_RATE_PER_MIN: undefined,
};

test("the provider is off, and dub stays off, with nothing configured", () => {
  const restore = withEnv(BASE_ENV);
  try {
    const config = aniConfig();
    assert.equal(config.enabled, false);
    assert.equal(config.dubEnabled, false);
    assert.equal(config.baseUrl, null);
    assert.equal(config.apiKey, null);
    assert.equal(aniReady(config), false);
    // Documented defaults.
    assert.equal(config.percent, 100);
    assert.equal(config.timeoutMs, 15_000);
    assert.equal(config.maxConcurrency, 4);
    assert.equal(config.ratePerMin, 40);
  } finally {
    restore();
  }
});

test("only the literal 1 enables the provider (and dub)", () => {
  const restore = withEnv({
    ...BASE_ENV,
    ANI_PROVIDER_ENABLED: "true",
    ANI_DUB_ENABLED: "yes",
  });
  try {
    assert.equal(aniConfig().enabled, false);
    assert.equal(aniConfig().dubEnabled, false);
    process.env.ANI_PROVIDER_ENABLED = "1";
    process.env.ANI_DUB_ENABLED = "1";
    assert.equal(aniConfig().enabled, true);
    assert.equal(aniConfig().dubEnabled, true);
  } finally {
    restore();
  }
});

test("the base url loses its trailing slash and is refused when invalid", () => {
  const restore = withEnv({ ...BASE_ENV, ANI_API_BASE_URL: "https://ani-api.kumoritv.top/" });
  try {
    assert.equal(aniConfig().baseUrl, "https://ani-api.kumoritv.top");
    process.env.ANI_API_BASE_URL = "ftp://nope";
    assert.equal(aniConfig().baseUrl, null);
    process.env.ANI_API_BASE_URL = "  ";
    assert.equal(aniConfig().baseUrl, null);
  } finally {
    restore();
  }
});

test("invalid numbers fall back to the documented defaults", () => {
  const restore = withEnv({
    ...BASE_ENV,
    ANI_API_TIMEOUT_MS: "abc",
    ANI_MAX_CONCURRENCY: "-3",
    ANI_RATE_PER_MIN: "0",
  });
  try {
    const config = aniConfig();
    assert.equal(config.timeoutMs, 15_000);
    assert.equal(config.maxConcurrency, 4);
    assert.equal(config.ratePerMin, 40);
  } finally {
    restore();
  }
});

test("the rate limit can never be configured above the API's own ceiling", () => {
  const restore = withEnv({ ...BASE_ENV, ANI_RATE_PER_MIN: "500", ANI_MAX_CONCURRENCY: "99" });
  try {
    assert.equal(aniConfig().ratePerMin, 55);
    assert.equal(aniConfig().maxConcurrency, 16);
  } finally {
    restore();
  }
});

test("percent is clamped to 0-100", () => {
  const restore = withEnv({ ...BASE_ENV, ANI_PROVIDER_PERCENT: "250" });
  try {
    assert.equal(aniConfig().percent, 100);
    process.env.ANI_PROVIDER_PERCENT = "-4";
    assert.equal(aniConfig().percent, 0);
    process.env.ANI_PROVIDER_PERCENT = "37";
    assert.equal(aniConfig().percent, 37);
  } finally {
    restore();
  }
});

test("the rollout bucket is stable, in range, and identical for the same id", () => {
  const first = aniBucket(21);
  assert.ok(first >= 0 && first < 100);
  for (let attempt = 0; attempt < 20; attempt++) assert.equal(aniBucket(21), first);
  assert.equal(aniBucket("21"), aniBucket(21));
  assert.notEqual(aniBucket(21), aniBucket(52299));
});

test("percent 0 never rolls out and percent 100 always does", () => {
  const restore = withEnv({
    ...BASE_ENV,
    ANI_PROVIDER_ENABLED: "1",
    ANI_PROVIDER_PERCENT: "0",
  });
  try {
    assert.equal(aniRolloutAllows(21), false);
    process.env.ANI_PROVIDER_PERCENT = "100";
    assert.equal(aniRolloutAllows(21), true);
    assert.equal(aniRolloutAllows(52299), true);
  } finally {
    restore();
  }
});

test("a partial rollout only ever adds anime as the percentage rises", () => {
  const ids = [21, 16498, 52299, 1, 100, 777, 12345];
  const inside = (percent: number) => {
    const restore = withEnv({ ...BASE_ENV, ANI_PROVIDER_PERCENT: String(percent) });
    try {
      return ids.filter((id) => aniRolloutAllows(id));
    } finally {
      restore();
    }
  };
  const at10 = inside(10);
  const at50 = inside(50);
  const at100 = inside(100);
  assert.deepEqual(at10, at10.filter((id) => at50.includes(id)));
  assert.deepEqual(at50, at50.filter((id) => at100.includes(id)));
  assert.deepEqual(at100, ids);
});
