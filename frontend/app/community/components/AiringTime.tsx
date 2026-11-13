"use client";
// The rail is server-rendered, and the server has no idea which zone the reader
// is in. Render UTC first so the HTML is stable, then settle to the browser's
// own zone after hydration, the same way the feed's timestamps do.
import { useEffect, useState } from "react";

function label(airingAt: number, local: boolean): string {
  const date = new Date(airingAt * 1000);
  const timeZone = local ? undefined : "UTC";
  const day = date.toLocaleDateString(undefined, { weekday: "short", timeZone });
  const time = date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
  return `${day}, ${time}`;
}

export default function AiringTime({ airingAt }: { airingAt: number }) {
  const [text, setText] = useState(() => label(airingAt, false));

  useEffect(() => {
    setText(label(airingAt, true));
  }, [airingAt]);

  return <span suppressHydrationWarning>{text}</span>;
}
