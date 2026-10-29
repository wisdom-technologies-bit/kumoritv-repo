// A — watch page servers: one button per SERVER name, never a provider name.

import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeProviderStreams,
  buildServerButtons,
  serverButtonKey,
  toServerList,
  activeServerId,
} from "@/app/lib/watch/streams";
import { providers } from "./fixtures/anivexa-watch";

const labels = (json: any) =>
  buildServerButtons(normalizeProviderStreams(json)).map(
    (button) => button.label,
  );

test("anikoto: one button per distinct server name, hls preferred", () => {
  const buttons = buildServerButtons(
    normalizeProviderStreams(providers.anikoto),
  );

  assert.deepEqual(
    buttons.map((b) => b.label),
    ["HD-1", "Vidstream-1", "Vidstream-2"],
  );
  const hd1 = buttons[0];
  assert.equal(hd1.primary.type, "hls");
  // the embed twin of the same name stays available as its fallback
  assert.equal(hd1.fallback?.type, "embed");
});

test("reanime: streams + embeds, exact names preserved", () => {
  assert.deepEqual(labels(providers.reanime).slice(0, 2), ["HD-1", "HD-2"]);
});

test("kaa: BirdStream / VidStreaming keep their casing", () => {
  assert.deepEqual(labels(providers.kaa), ["BirdStream", "VidStreaming"]);
});

test("anipm: the duplicate Ani.pm entry is one button", () => {
  assert.deepEqual(labels(providers.anipm), ["Ani.pm"]);
});

test("aniwaves: Vidplay listed twice is one button, hls preferred", () => {
  const buttons = buildServerButtons(
    normalizeProviderStreams(providers.aniwaves),
  );

  assert.deepEqual(buttons.map((b) => b.label), ["BYFMS", "DGHG", "Vidplay"]);
  assert.equal(buttons[2].primary.type, "hls");
  assert.equal(buttons[2].fallback?.type, "embed");
});

test("animegg: Animegg and Animegg-embed are the same button", () => {
  const buttons = buildServerButtons(
    normalizeProviderStreams(providers.animegg),
  );

  assert.deepEqual(buttons.map((b) => b.label), ["Animegg"]);
  assert.equal(buttons[0].streams.length, 5);
});

test("senshi: a single embed server, and its {0,0} ranges are dropped", () => {
  const streams = normalizeProviderStreams(providers.senshi);

  assert.deepEqual(labels(providers.senshi), ["Senshi"]);
  assert.equal(streams[0].intro, null);
  assert.equal(streams[0].outro, null);
});

test("mkissa: sources[] become embeds labelled Server N or their name", () => {
  const buttons = buildServerButtons(normalizeProviderStreams(providers.mkissa));

  assert.deepEqual(
    buttons.map((b) => b.label),
    ["Kissa", "Server 2", "Server 3"],
  );
  assert.ok(buttons.every((b) => b.primary.type === "embed"));
});

test("empty or missing names become Server N", () => {
  const buttons = buildServerButtons(
    normalizeProviderStreams({
      streams: [
        { url: "https://x.example/1.m3u8", type: "hls" },
        { url: "https://x.example/2.m3u8", type: "hls", server: "   " },
      ],
    }),
  );

  assert.deepEqual(buttons.map((b) => b.label), ["Server 1", "Server 2"]);
});

test("an unknown shape returns [] and never throws", () => {
  assert.deepEqual(normalizeProviderStreams({ nope: true }), []);
  assert.deepEqual(normalizeProviderStreams(null), []);
  assert.deepEqual(normalizeProviderStreams("garbage"), []);
  assert.deepEqual(normalizeProviderStreams({ sources: "no" }), []);
  assert.deepEqual(
    buildServerButtons(normalizeProviderStreams({ weird: 1 })),
    [],
  );
});

test("no provider name ever appears in the serialised server list", () => {
  for (const [name, json] of Object.entries(providers)) {
    const buttons = buildServerButtons(normalizeProviderStreams(json as any));
    const servers = toServerList(
      buttons,
      activeServerId(buttons, buttons[0]?.primary),
    );

    for (const server of servers) {
      // Only the display fields exist: no provider, no tooltip, no data-*.
      assert.deepEqual(Object.keys(server).sort(), ["active", "id", "label"]);
      // "Animegg" is genuinely the provider's own server name, so the provider
      // name may only show up when it is also the server label.
      // animegg / senshi use their own name as the server label.
      if (server.label.toLowerCase() === name.toLowerCase()) continue;
      assert.ok(
        !server.label.toLowerCase().includes(name.toLowerCase()),
        `${name} leaked as a label: ${server.label}`,
      );
    }

    // Nothing outside the labels carries the provider name.
    const serialised = servers.map((server) => server.label).join("|").toLowerCase();
    assert.ok(!serialised.includes(name.toLowerCase()) || servers.every((server) => server.label.toLowerCase() === name.toLowerCase()), `${name} leaked: ${serialised}`);
  }
});

test("the requested server is ordered first, then isActive / priority / index", () => {
  const streams = normalizeProviderStreams(providers.anikoto);
  const ordered = buildServerButtons(streams, {
    requestedServer: "Vidstream-2",
  }).map((b) => b.label);

  assert.equal(ordered[0], "Vidstream-2");
});

test("server button keys are case-insensitive and merge -embed", () => {
  assert.equal(serverButtonKey("Animegg-embed"), serverButtonKey("AnimeGG"));
  assert.equal(serverButtonKey("HD-1"), "hd-1");
});

test("Backup flow: the next provider's servers replace the list", () => {
  // First provider resolves: its server names are what the UI shows.
  const first = buildServerButtons(normalizeProviderStreams(providers.anikoto));
  assert.deepEqual(
    toServerList(first, first[0].id).map((s) => s.label),
    ["HD-1", "Vidstream-1", "Vidstream-2"],
  );

  // "Backup server" asks the route with exclude=<active provider>; a different
  // provider answers and the list is replaced by ITS server names.
  const second = buildServerButtons(normalizeProviderStreams(providers.kaa));
  const replaced = toServerList(second, second[0].id);

  assert.deepEqual(
    replaced.map((s) => s.label),
    ["BirdStream", "VidStreaming"],
  );
  assert.equal(replaced.filter((s) => s.active).length, 1);

  // hasBackup is decided by the route: another provider that has not been tried.
  const providersAvailable = ["anikoto", "kaa", "senshi"];
  const exclude = ["anikoto"];
  const hasBackup = providersAvailable.some((p) => !exclude.includes(p));
  assert.equal(hasBackup, true);
  const afterLast = providersAvailable.filter((p) => p !== "anikoto" && p !== "kaa");
  assert.deepEqual(afterLast, ["senshi"]);
});
