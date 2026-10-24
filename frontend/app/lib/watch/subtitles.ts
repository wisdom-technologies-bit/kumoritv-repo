const LANGS: Record<string, string> = {
  english: "en", arabic: "ar", french: "fr", spanish: "es", portuguese: "pt",
  german: "de", italian: "it", russian: "ru", indonesian: "id", japanese: "ja",
  chinese: "zh", korean: "ko", turkish: "tr", vietnamese: "vi", thai: "th",
  hindi: "hi", polish: "pl", dutch: "nl",
};

export function labelToLang(label: string) {
  const raw = String(label || "Unknown").trim();
  const word = raw.split(/[\s(\[]/)[0].toLowerCase();
  return {
    lang: LANGS[word] || "und",
    name: raw,
    kind: /signs|songs|forced/i.test(raw) ? "signs" : /dubtitle/i.test(raw) ? "dubtitle" : "full",
  } as const;
}

function preferredCode(value: string) {
  const normalized = String(value || "").trim().toLowerCase();
  return LANGS[normalized] || normalized.slice(0, 2);
}

function cleanLabel(label: string) {
  return String(label || "Unknown")
    .replace(/\s*\(-\s*([^()]+)\(([^()]+)\)\)/g, " ($2)")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeSubtitles(streamSubtitles: any[] = [], topLevelSubtitles: any[] = [], preferredLang = "en") {
  const map = new Map<string, any>();
  let thumbnails: any = null;
  for (const item of [...streamSubtitles, ...topLevelSubtitles]) {
    if (!item?.url || map.has(item.url)) continue;
    const rawLabel = cleanLabel(item.label || item.language || "Unknown");
    const source = `${rawLabel} ${item.kind || ""} ${item.file || ""} ${item.url}`;
    if (/thumbnail|thumbnails|sprite|storyboard|preview/i.test(source) || String(item.kind).toLowerCase() === "metadata") {
      thumbnails ||= { upstreamUrl: item.url, format: "vtt" };
      continue;
    }
    const meta = labelToLang(rawLabel);
    const format = String(item.format || item.url.split(/[?#]/)[0].split(".").pop() || "").toLowerCase();
    if (!["ass", "srt", "vtt"].includes(format)) continue;
    map.set(item.url, { ...meta, rawLabel, format, upstreamUrl: item.url, sourceDefault: item.default === true });
  }
  const preferred = preferredCode(preferredLang);
  const items = [...map.values()].sort((a, b) => Number(b.lang === preferred) - Number(a.lang === preferred) || Number(a.kind !== "full") - Number(b.kind !== "full"));
  const counts = new Map<string, number>();
  const publicItems = items.map((item, index) => {
    const count = (counts.get(item.lang) || 0) + 1;
    counts.set(item.lang, count);
    const hint = /sign/i.test(item.rawLabel) ? " (Signs)" : /song/i.test(item.rawLabel) ? " (Songs)" : /forced/i.test(item.rawLabel) ? " (Forced)" : "";
    return { ...item, id: `sub-${index + 1}`, label: `${item.rawLabel}${hint}${count > 1 && !hint ? ` (${count})` : ""}` };
  });
  const defaultItem = publicItems.find((item) => item.kind === "full" && item.lang === preferred && item.sourceDefault) || publicItems.find((item) => item.kind === "full" && item.lang === preferred) || publicItems.find((item) => item.kind === "full" && item.lang === "en") || publicItems.find((item) => item.kind === "full");
  return {
    subtitles: publicItems.map((item) => ({ id: item.id, label: item.label, lang: item.lang, kind: item.kind, default: item === defaultItem, url: item.upstreamUrl })),
    thumbnails,
  };
}
