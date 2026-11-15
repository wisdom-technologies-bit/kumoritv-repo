import assert from "node:assert/strict";
import test from "node:test";
import {
  directSegmentHostsFor,
  directSegmentUrl,
  payloadNeedsReferer,
} from "../direct-segments";

test("no Referer: the operator allow-list applies (legacy ZokoAnime CDN)", () => {
  const hosts = ["hls1.drama1.cfd"];
  assert.equal(payloadNeedsReferer({ "user-agent": "x" }), false);
  assert.deepEqual(directSegmentHostsFor({ "user-agent": "x" }, hosts), hosts);
  assert.deepEqual(directSegmentHostsFor(undefined, hosts), hosts);
  assert.deepEqual(directSegmentHostsFor({}, hosts), hosts);
});

test("ANY Referer refuses the shortcut (AniKoto would 403 in the browser)", () => {
  const hosts = ["hls1.drama1.cfd"];
  const cases: Record<string, string>[] = [
    { Referer: "https://megaplay.buzz/" },
    { referer: "https://megaplay.buzz/" },
    { REFERER: "https://megaplay.buzz/" },
    { "user-agent": "x", Referer: "https://zokoanime.video/" },
  ];
  for (const headers of cases) {
    assert.equal(payloadNeedsReferer(headers), true, JSON.stringify(headers));
    assert.deepEqual(directSegmentHostsFor(headers, hosts), []);
  }
  // An empty Referer is not a Referer.
  assert.equal(payloadNeedsReferer({ Referer: "   " }), false);
});

test("empty host list never yields a direct URL", () => {
  assert.equal(directSegmentUrl("https://hls1.drama1.cfd/a.jpg", "https://h/x.m3u8", []), null);
});
