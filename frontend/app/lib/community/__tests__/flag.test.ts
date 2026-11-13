// Prompt 38B: COMMUNITY_ENABLED is read at request time, so a deployment can
// turn the feature off (and back on) without a rebuild.
import assert from "node:assert/strict";
import test from "node:test";
import { isCommunityEnabled } from "../flag";

const previous = process.env.COMMUNITY_ENABLED;

function withEnv(value: string | undefined, run: () => void) {
  if (value === undefined) delete process.env.COMMUNITY_ENABLED;
  else process.env.COMMUNITY_ENABLED = value;
  try {
    run();
  } finally {
    if (previous === undefined) delete process.env.COMMUNITY_ENABLED;
    else process.env.COMMUNITY_ENABLED = previous;
  }
}

test("unset, empty and falsy values keep the feature off", () => {
  for (const value of [undefined, "", "0", "false", "no", "off", "  "]) {
    withEnv(value, () => assert.equal(isCommunityEnabled(), false, `COMMUNITY_ENABLED=${value}`));
  }
});

test("1, true, yes and on turn it on", () => {
  for (const value of ["1", "true", "TRUE", "yes", "on", " true "]) {
    withEnv(value, () => assert.equal(isCommunityEnabled(), true, `COMMUNITY_ENABLED=${value}`));
  }
});

test("the flag is re-read on every call (per request, not per build)", () => {
  withEnv("0", () => assert.equal(isCommunityEnabled(), false));
  withEnv("1", () => assert.equal(isCommunityEnabled(), true));
});
