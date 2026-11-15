// Prompt 40: the fallback VAST client's pure parts.
import assert from "node:assert/strict";
import test from "node:test";
import {
  VastParseError,
  parseSkipOffset,
  parseVast,
  parseVastDuration,
  pickMediaFile,
  replaceMacros,
  vastErrorCode,
  type VastMediaFile,
} from "../lib/ads/vast";

const INLINE = `<?xml version="1.0" encoding="UTF-8"?>
<VAST version="4.0">
  <Ad id="ad-1">
    <Inline>
      <AdSystem>Adcash</AdSystem>
      <AdTitle>Test pre-roll</AdTitle>
      <Impression><![CDATA[https://ads.example/imp?cb=[CACHEBUSTING]]]></Impression>
      <Error><![CDATA[https://ads.example/err?code=[ERRORCODE]]]></Error>
      <Creatives>
        <Creative>
          <Linear skipoffset="00:00:05">
            <Duration>00:00:15</Duration>
            <TrackingEvents>
              <Tracking event="start"><![CDATA[https://ads.example/start]]></Tracking>
              <Tracking event="firstQuartile"><![CDATA[https://ads.example/q1]]></Tracking>
              <Tracking event="midpoint"><![CDATA[https://ads.example/mid]]></Tracking>
              <Tracking event="thirdQuartile"><![CDATA[https://ads.example/q3]]></Tracking>
              <Tracking event="complete"><![CDATA[https://ads.example/done]]></Tracking>
              <Tracking event="skip"><![CDATA[https://ads.example/skip]]></Tracking>
            </TrackingEvents>
            <MediaFiles>
              <MediaFile type="video/mp4" bitrate="400" width="640" height="360" delivery="progressive"><![CDATA[https://cdn.example/360.mp4]]></MediaFile>
              <MediaFile type="video/mp4" bitrate="900" width="1280" height="720"><![CDATA[https://cdn.example/720.mp4]]></MediaFile>
              <MediaFile type="application/x-shockwave-flash"><![CDATA[https://cdn.example/x.swf]]></MediaFile>
            </MediaFiles>
            <VideoClicks>
              <ClickThrough><![CDATA[https://advertiser.example/landing]]></ClickThrough>
              <ClickTracking><![CDATA[https://ads.example/click]]></ClickTracking>
            </VideoClicks>
          </Linear>
        </Creative>
      </Creatives>
    </Inline>
  </Ad>
</VAST>`;

const WRAPPER = `<VAST version="3.0">
  <Ad id="w-1">
    <Wrapper>
      <AdSystem>Adcash</AdSystem>
      <VASTAdTagURI><![CDATA[https://ads.example/next]]></VASTAdTagURI>
      <Impression><![CDATA[https://ads.example/wrapper-imp]]></Impression>
      <Error><![CDATA[https://ads.example/wrapper-err]]></Error>
      <Creatives><Creative><Linear><TrackingEvents>
        <Tracking event="start"><![CDATA[https://ads.example/wrapper-start]]></Tracking>
      </TrackingEvents></Linear></Creative></Creatives>
    </Wrapper>
  </Ad>
</VAST>`;

test("an inline VAST 4 document is read completely", () => {
  const document = parseVast(INLINE);
  const ad = document.ads[0];

  assert.equal(document.version, "4.0");
  assert.equal(ad.type, "inline");
  assert.equal(ad.durationSec, 15);
  assert.equal(ad.skipOffsetSec, 5);
  assert.equal(ad.clickThrough, "https://advertiser.example/landing");
  assert.deepEqual(ad.impressionUrls, ["https://ads.example/imp?cb=[CACHEBUSTING]"]);
  assert.equal(ad.tracking.start.length, 1);
  assert.equal(ad.tracking.skip[0], "https://ads.example/skip");
  // The .swf MediaFile is kept by the parser but never chosen by pickMediaFile.
  assert.equal(ad.mediaFiles.length, 3);
});

test("a wrapper is reported as a wrapper with its tag URI and inherited tracking", () => {
  const ad = parseVast(WRAPPER).ads[0];

  assert.equal(ad.type, "wrapper");
  assert.equal(ad.wrapperUrl, "https://ads.example/next");
  assert.equal(ad.impressionUrls[0], "https://ads.example/wrapper-imp");
  assert.equal(ad.tracking.start[0], "https://ads.example/wrapper-start");
  assert.equal(ad.mediaFiles.length, 0);
});

test("an empty VAST is no fill, and bad XML throws", () => {
  assert.deepEqual(parseVast("<VAST></VAST>").ads, []);
  assert.throws(() => parseVast("<VAST><Ad>"), VastParseError);
  assert.throws(() => parseVast("not xml at all"), VastParseError);
  assert.throws(() => parseVast(""), VastParseError);
});

test("skipoffset accepts a clock value, free seconds and a percentage", () => {
  assert.equal(parseVastDuration("00:00:05"), 5);
  assert.equal(parseVastDuration("00:01:30"), 90);
  assert.equal(parseVastDuration("00:05"), 5);
  assert.equal(parseVastDuration("12"), 12);
  assert.equal(parseVastDuration("nope"), null);
  assert.equal(parseSkipOffset("00:00:05", 15), 5);
  assert.equal(parseSkipOffset("10%", 20), 2);
  assert.equal(parseSkipOffset("10%", null), null, "a percentage needs a duration");
  assert.equal(parseSkipOffset(null, 15), null);
});

test("the best MP4 for the viewport and bandwidth wins", () => {
  const files: VastMediaFile[] = parseVast(INLINE).ads[0].mediaFiles;

  assert.equal(pickMediaFile(files, { viewportHeight: 400 })?.url, "https://cdn.example/360.mp4");
  assert.equal(pickMediaFile(files, { viewportHeight: 800 })?.url, "https://cdn.example/720.mp4");
  assert.equal(
    pickMediaFile(files, { viewportHeight: 800, bandwidthKbps: 500 })?.url,
    "https://cdn.example/360.mp4",
    "a slow connection takes the lighter file",
  );
  assert.equal(pickMediaFile([], {}), null);
  assert.equal(
    pickMediaFile([{ url: "https://cdn.example/vpaid.js", type: "application/javascript", bitrate: null, width: null, height: null, delivery: null }]),
    null,
    "VPAID is not playable by this engine",
  );
});

test("macros are replaced, unknown ones are left alone", () => {
  const filled = replaceMacros("https://ads.example/t?cb=[CACHEBUSTING]&code=[ERRORCODE]&ph=[CONTENTPLAYHEAD]&u=[ASSETURI]&t=[TIMESTAMP]&x=[UNKNOWN]", {
    cacheBusting: "123",
    errorCode: 303,
    contentPlayhead: "00:00:01.000",
    assetUri: "https://cdn.example/a.mp4",
    timestamp: "2026-11-15T00:00:00.000Z",
  });

  assert.match(filled, /cb=123/);
  assert.match(filled, /code=303/);
  assert.match(filled, /ph=00%3A00%3A01\.000/);
  assert.match(filled, /u=https%3A%2F%2Fcdn\.example%2Fa\.mp4/);
  assert.match(filled, /t=2026-11-15T00%3A00%3A00\.000Z/);
  assert.match(filled, /x=\[UNKNOWN\]/);
  assert.match(replaceMacros("https://ads.example/[CACHEBUSTING]"), /\/\d{9}$/);
});

test("failure reasons map to VAST error codes", () => {
  assert.equal(vastErrorCode("bad_xml"), 100);
  assert.equal(vastErrorCode("timeout"), 301);
  assert.equal(vastErrorCode("wrapper_limit"), 302);
  assert.equal(vastErrorCode("no_fill"), 303);
  assert.equal(vastErrorCode("no_media"), 403);
  assert.equal(vastErrorCode("media_error"), 405);
  assert.equal(vastErrorCode("ad_too_long"), 405);
  assert.equal(vastErrorCode("something_else"), 900);
});
