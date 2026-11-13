// Captures one watch response (ani switched OFF) as JSON, for the regression
// snapshot that proves the Anivexa path is unchanged.
//
//   TSX_TSCONFIG_PATH=tsconfig.test.json node --import tsx --import ./test-harness/register-dom.mjs scripts/ani-capture.mjs
//
// The stand-ins are local and in-process; no real provider is contacted.
import { startWatchHarness } from "../app/lib/ani/__tests__/watch-harness.ts";

const harness = await startWatchHarness();
try {
  // No harness.reset() on purpose: the master worktree has no app/lib/ani, and
  // this script must run there unchanged to produce the reference snapshot.
  process.env.ANI_PROVIDER_ENABLED = "0";
  const { status, normalised } = await harness.call({
    audio: "sub",
    sublang: "en",
  });
  process.stderr.write(`status=${status}\n`);
  process.stdout.write(`${JSON.stringify(normalised, null, 2)}\n`);
} finally {
  await harness.close();
}
