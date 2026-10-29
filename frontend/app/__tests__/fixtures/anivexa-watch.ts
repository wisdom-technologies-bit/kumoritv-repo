// Real AniVexa watch-response shapes, as measured from live responses.
// One fixture per provider; used by the streams / skip / route tests.

const subs = (url: string) => ({ url, lang: "English" });

export const anikoto = {
  anilistId: 1,
  episode: 1,
  streams: [
    {
      url: "https://cdn.example/hd1/master.m3u8",
      type: "hls",
      server: "HD-1",
      embedUrl: "https://embed.example/hd1",
      referer: "https://anikoto.example/",
      subtitles: [subs("https://subs.example/en.vtt"), subs("https://cdn.example/preview/thumbnails.vtt")],
      priority: 1,
      isActive: true,
      subtitleType: "soft",
      variant: "sub",
      intro: { start: 0, end: 89 },
      outro: { start: 1460, end: 1549 },
    },
    {
      url: "https://embed.example/hd1",
      type: "embed",
      server: "HD-1",
      embedUrl: "https://embed.example/hd1",
      priority: 1,
      isActive: false,
    },
    {
      url: "https://cdn.example/vs1/master.m3u8",
      type: "hls",
      server: "Vidstream-1",
      embedUrl: "https://embed.example/vs1",
      priority: 2,
      isActive: false,
      intro: { start: 0, end: 89 },
      outro: { start: 1460, end: 1549 },
    },
    {
      url: "https://embed.example/vs1",
      type: "embed",
      server: "Vidstream-1",
      embedUrl: "https://embed.example/vs1",
      priority: 2,
    },
    {
      url: "https://cdn.example/vs2/master.m3u8",
      type: "hls",
      server: "Vidstream-2",
      embedUrl: "https://embed.example/vs2",
      priority: 3,
      intro: { start: 0, end: 89 },
      outro: { start: 1460, end: 1549 },
    },
    {
      url: "https://embed.example/vs2",
      type: "embed",
      server: "Vidstream-2",
      embedUrl: "https://embed.example/vs2",
      priority: 3,
    },
  ],
  subtitles: [subs("https://subs.example/en.vtt")],
  downloads: [{ label: "Kiwi", url: "https://dl.example/1.mp4" }],
  headers: { "User-Agent": "Mozilla/5.0", Referer: "https://anikoto.example/" },
};

export const reanime = {
  anime: { title: "Test" },
  streams: [
    { url: "https://re.example/hd1.m3u8", type: "hls", server: "HD-1", priority: 1, isActive: true },
    { url: "https://re.example/hd2.m3u8", type: "hls", server: "HD-2", priority: 2 },
  ],
  embeds: ["https://embed.example/re-1"],
  allServers: ["HD-1", "HD-2"],
  failedServers: [],
  subtitles: [subs("https://subs.example/re.vtt")],
  intro: { start: 0, end: 90, title: "Opening" },
  outro: { start: 1459, end: 1549, title: "Ending" },
};

export const kaa = {
  streams: [
    {
      url: "https://kaa.example/bird.m3u8",
      type: "hls",
      server: "BirdStream",
      headers: { Referer: "https://kaa.example/" },
      priority: 1,
    },
    {
      url: "https://kaa.example/vid.m3u8",
      type: "hls",
      server: "VidStreaming",
      headers: { Referer: "https://kaa.example/" },
      priority: 2,
    },
  ],
};

export const anipm = {
  streams: [
    {
      url: "https://anipm.example/a.m3u8",
      type: "hls",
      server: "Ani.pm",
      subtitles: [{ url: "https://subs.example/a.vtt", label: "English", audioLang: "en", headers: { Referer: "https://anipm.example/" } }],
      priority: 1,
    },
    {
      url: "https://anipm.example/a-backup.m3u8",
      type: "hls",
      server: "Ani.pm",
      subtitles: [{ url: "https://subs.example/b.vtt", label: "Arabic", audioLang: "ar" }],
      priority: 2,
    },
  ],
};

export const aniwaves = {
  streams: [
    { url: "https://aw.example/byfms", type: "embed", server: "BYFMS", priority: 1 },
    { url: "https://aw.example/dghg", type: "embed", server: "DGHG", priority: 2 },
    { url: "https://aw.example/vidplay", type: "embed", server: "Vidplay", priority: 3 },
    { url: "https://aw.example/vidplay-hls.m3u8", type: "hls", server: "Vidplay", priority: 4 },
  ],
  intro: {},
  outro: {},
};

export const animegg = {
  streams: [
    { url: "https://ag.example/1.m3u8", type: "embed", server: "Animegg", quality: "1080p", backup: false, priority: 1 },
    { url: "https://ag.example/2.m3u8", type: "embed", server: "Animegg", quality: "720p", backup: true, priority: 2 },
    { url: "https://ag.example/3.m3u8", type: "embed", server: "Animegg", quality: "480p", backup: true, priority: 3 },
    { url: "https://ag.example/4.m3u8", type: "embed", server: "Animegg", quality: "360p", backup: true, priority: 4 },
    { url: "https://ag.example/embed/x", type: "embed", server: "Animegg-embed", priority: 5 },
  ],
};

export const senshi = {
  streams: [{ url: "https://senshi.example/embed", type: "embed", server: "Senshi", priority: 1 }],
  intro: { start: 0, end: 0 },
  outro: { start: 0, end: 0 },
};

export const mkissa = {
  sources: [
    {
      name: "Kissa",
      sourceName: "Kissa",
      type: "iframe",
      url: "https://mkissa.example/watch/1",
      extractedUrl: "https://mkissa.example/extracted/1",
      extractedType: "iframe",
      headers: { Referer: "https://mkissa.example/" },
      downloadUrl: "https://mkissa.example/dl/1.mp4",
      priority: 1,
    },
    {
      name: "https://mkissa.example/raw",
      sourceName: "",
      type: "iframe",
      url: "https://mkissa.example/raw-stream",
      priority: 2,
    },
    {
      name: "",
      sourceName: "",
      type: "iframe",
      url: "https://mkissa.example/third",
      priority: 3,
    },
  ],
};

export const providers = {
  anikoto,
  reanime,
  kaa,
  anipm,
  aniwaves,
  animegg,
  senshi,
  mkissa,
};
