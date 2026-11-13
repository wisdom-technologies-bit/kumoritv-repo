"use client";
import Image from "next/image";
import { useEffect, useState } from "react";
import { formatTimeAgo } from "@/app/lib/comments/timeAgo";
import styles from "../page.module.css";

/** Avatar with the same fallback the comments list uses (initial letter). */
export function Avatar({ url, name, size = 40 }: { url?: string | null; name?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  const initial = (name ?? "?").trim().charAt(0).toUpperCase() || "?";
  const showImage = Boolean(url) && !broken;

  return (
    <span className={styles.avatar} style={{ width: size, height: size }} aria-hidden="true">
      {showImage ? (
        <Image
          src={url as string}
          alt=""
          width={size}
          height={size}
          onError={() => setBroken(true)}
          unoptimized
        />
      ) : (
        initial
      )}
    </span>
  );
}

/** Relative time. Renders a stable string on the server and after hydration:
 *  the first paint uses the timestamp as given, the effect settles it. */
export function TimeStamp({ iso, className }: { iso: string; className?: string }) {
  const [label, setLabel] = useState(() => formatTimeAgo(iso));

  useEffect(() => {
    setLabel(formatTimeAgo(iso));
    const timer = window.setInterval(() => setLabel(formatTimeAgo(iso)), 60_000);
    return () => window.clearInterval(timer);
  }, [iso]);

  const absolute = (() => {
    const date = new Date(iso);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : "";
  })();

  return (
    <time className={className} dateTime={iso} title={absolute}>
      {label}
    </time>
  );
}

/** Copies an absolute URL, with a visible "Copied" state and a safe fallback. */
export function useCopyLink() {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy(path: string) {
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    const url = path.startsWith("http") ? path : `${origin}${path}`;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        throw new Error("no clipboard");
      }
    } catch {
      // Older Safari / non-secure context: a hidden textarea still works.
      try {
        const area = document.createElement("textarea");
        area.value = url;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
      } catch {
        return false;
      }
    }
    setCopied(true);
    return true;
  }

  return { copied, copy };
}
