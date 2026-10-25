import { verifyToken, ProxyNotConfiguredError } from "@/app/lib/proxy/signing";
import { readResponseText, safeFetch } from "@/app/lib/proxy/upstream";

export const runtime = "edge";

function toVttTime(value: string): string {
  const input = value.trim();

  // ASS/SSA timestamps: H:MM:SS.cc
  const ass = input.match(/^(\d+):(\d{2}):(\d{2})[.](\d{1,3})$/);
  if (ass) {
    const hours = ass[1].padStart(2, "0");
    const minutes = ass[2];
    const seconds = ass[3];
    const fraction = ass[4].padEnd(3, "0").slice(0, 3);
    return `${hours}:${minutes}:${seconds}.${fraction}`;
  }

  // SRT timestamps: HH:MM:SS,mmm or HH:MM:SS.mmm
  const srt = input.match(/^(\d+):(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if (srt) {
    return `${srt[1].padStart(2, "0")}:${srt[2]}:${srt[3]}.${srt[4].padEnd(3, "0")}`;
  }

  return input;
}

function convert(input: string): string {
  const text = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");

  // Already WebVTT
  const trimmed = text.trimStart();
  if (/^WEBVTT(?:\s|$)/i.test(trimmed)) {
    return `WEBVTT${trimmed.slice(6)}`;
  }

  // ASS/SSA subtitle format
  if (/^\s*\[Script Info\]/im.test(text) || /^\s*\[Events\]/im.test(text)) {
    const lines = text.split("\n");
    const formatLine = lines.find((line) => /^\s*Format\s*:/i.test(line));
    const fields = (
      formatLine?.slice(formatLine.indexOf(":") + 1) ||
      "Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"
    )
      .split(",")
      .map((field) => field.trim().toLowerCase());

    const startIndex = fields.indexOf("start");
    const endIndex = fields.indexOf("end");
    const styleIndex = fields.indexOf("style");
    const textIndex = fields.lastIndexOf("text");

    if (startIndex < 0 || endIndex < 0 || textIndex < 0) {
      return "WEBVTT\n\n";
    }

    const output = ["WEBVTT", ""];

    for (const line of lines) {
      if (!/^\s*Dialogue\s*:/i.test(line)) continue;

      const raw = line.slice(line.indexOf(":") + 1).trim();
      const values: string[] = [];
      let remaining = raw;

      // Split only the fields before Text so commas inside captions survive.
      for (let i = 0; i < fields.length - 1; i++) {
        const comma = remaining.indexOf(",");
        if (comma < 0) break;
        values.push(remaining.slice(0, comma));
        remaining = remaining.slice(comma + 1);
      }
      values.push(remaining);

      const start = values[startIndex]?.trim();
      const end = values[endIndex]?.trim();
      const style = values[styleIndex]?.trim() || "Default";

      if (!start || !end || values.length < fields.length) continue;

      // Skip signs/songs and positioned karaoke or drawing-only subtitles.
      if (
        !/^default$/i.test(style) &&
        /(sign|song|karaoke|romaji|kanji|credit|title|typeset|^op|^ed|_op|_ed)/i.test(
          style,
        )
      ) {
        continue;
      }

      let caption = values[textIndex] || "";

      if (/\\p[1-9]/i.test(caption)) continue;

      caption = caption
        .replace(/\{[^}]*\}/g, "")
        .replace(/\\[Nn]/g, "\n")
        .replace(/\\h/g, " ")
        .trim();

      if (!caption) continue;

      output.push(`${toVttTime(start)} --> ${toVttTime(end)}\n${caption}\n`);
    }

    return output.join("\n");
  }

  // SRT or another timestamped subtitle format
  const output = ["WEBVTT", ""];
  const blocks = text.split(/\n\s*\n/).filter((block) => block.trim());

  for (const block of blocks) {
    const lines = block.split("\n");
    const timeIndex = lines.findIndex((line) => line.includes("-->"));

    if (timeIndex < 0) continue;

    const timing = lines[timeIndex].trim();
    const match = timing.match(/^(\S+)\s+-->\s+(\S+)(.*)$/);

    if (!match) continue;

    const start = toVttTime(match[1]);
    const end = toVttTime(match[2]);
    const settings = match[3] || "";
    const captionLines = lines
      .filter(
        (_, index) => index !== timeIndex && !/^\s*\d+\s*$/.test(lines[index]),
      )
      .filter((line) => !/^\s*(?:WEBVTT|NOTE)\s*$/i.test(line));

    if (!captionLines.some((line) => line.trim())) continue;

    output.push(`${start} --> ${end}${settings}\n${captionLines.join("\n")}\n`);
  }

  return output.join("\n");
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("t");

  if (!token) {
    return new Response("invalid or expired token", { status: 403 });
  }

  let payload: Awaited<ReturnType<typeof verifyToken>>;

  try {
    payload = await verifyToken(token);
  } catch (error) {
    return new Response(
      error instanceof ProxyNotConfiguredError
        ? "proxy_not_configured"
        : "invalid or expired token",
      {
        status: error instanceof ProxyNotConfiguredError ? 500 : 403,
      },
    );
  }

  try {
    const result = await safeFetch(payload.u, {
      headers: payload.h,
      timeoutMs: 15000,
    });

    if (!result.response.ok) {
      return new Response(`upstream status ${result.response.status}`, {
        status: 502,
      });
    }

    const source = await readResponseText(result.response, {
      maxBytes: 6_000_000,
      timeoutMs: 15_000,
    });

    return new Response(convert(source), {
      headers: {
        "content-type": "text/vtt; charset=utf-8",
        "cache-control": "public, max-age=86400",
        "access-control-allow-origin": "*",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return new Response(
      error instanceof Error && error.message === "upstream_body_too_large"
        ? "subtitle too large"
        : "upstream fetch failed",
      { status: 502 },
    );
  }
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "*",
    },
  });
}
