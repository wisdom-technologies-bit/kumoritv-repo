import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DownloadSheet, type DownloadPayload } from "../sheet";

const payload: DownloadPayload = {
  available: true,
  provider: "Kiwi",
  note: null,
  groups: [
    {
      audio: "sub",
      options: [
        { quality: "1080p", url: "https://pahe.nekostream.site/s1" },
        { quality: "720p", url: "https://pahe.nekostream.site/s2" },
      ],
    },
    {
      audio: "dub",
      options: [{ quality: "1080p", url: "https://pahe.nekostream.site/d1" }],
    },
  ],
};

const render = (overrides: Partial<React.ComponentProps<typeof DownloadSheet>> = {}) =>
  renderToStaticMarkup(
    React.createElement(DownloadSheet, {
      title: "Download Episode 3",
      payload,
      audio: "sub",
      onAudio: () => {},
      onSelect: () => {},
      onClose: () => {},
      ...overrides,
    }),
  );

test("the sheet names the episode and the source, and never invents one", () => {
  const html = render();
  assert.match(html, /Download Episode 3/);
  assert.match(html, /Source: <strong>Kiwi<\/strong>/);
});

test("every quality is a real link that opens a new tab, safely", () => {
  const html = render();
  assert.match(html, /href="https:\/\/pahe\.nekostream\.site\/s1"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer nofollow"/);
  assert.match(html, /1080p/);
  assert.match(html, /720p/);
});

test("the honest note is always there; the sponsor note only when an ad is set", () => {
  assert.match(render(), /That site may show ads\./);
  assert.doesNotMatch(render(), /a sponsor page may open/);
  assert.match(
    render({ payload: { ...payload, ad: { url: "https://ads.example.com/click", intervalMin: 30 } } }),
    /Support KumoriTV: a sponsor page may open/,
  );
});

test("audio tabs only exist when both audios do", () => {
  const both = render();
  assert.match(both, /role="tablist"/);
  assert.match(both, />Sub</);
  assert.match(both, />Dub</);
  const subOnly = render({ payload: { ...payload, groups: [payload.groups[0]] } });
  assert.doesNotMatch(subOnly, /role="tablist"/);
  const dubActive = render({ audio: "dub" });
  assert.match(dubActive, /href="https:\/\/pahe\.nekostream\.site\/d1"/);
});
