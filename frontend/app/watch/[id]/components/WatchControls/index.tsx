"use client";
import Link from "next/link";
import styles from "./component.module.css";
import { useWatchState } from "../WatchState";

export default function WatchControls({
  anilistId,
  episode,
  audio,
  episodeCount,
}: {
  anilistId: number;
  episode: number;
  audio: "sub" | "dub";
  episodeCount?: number | null;
}) {
  const state = useWatchState();
  const hasSub = state.availableAudio.sub !== false;
  const hasDub = state.availableAudio.dub !== false;
  const all: any[] = state.servers.length
    ? state.servers
    : state.activeProvider
      ? [{ id: state.activeProvider, label: state.activeProvider }]
      : [];
  const servers = all.filter(
    (s) => s.healthy !== false || s.id === state.activeProvider,
  );

  return (
    <div className={styles.wrapper} data-testid="watch-controls">
      {episode > 1 ? (
        <Link
          className={styles.button}
          href={`/watch/${anilistId}?ep=${episode - 1}&audio=${audio}`}
        >
          ‹ Prev
        </Link>
      ) : (
        <button className={styles.button} disabled>
          ‹ Prev
        </button>
      )}
      {episodeCount && episode >= episodeCount ? (
        <button className={styles.button} disabled>
          Next ›
        </button>
      ) : (
        <Link
          className={styles.button}
          href={`/watch/${anilistId}?ep=${episode + 1}&audio=${audio}`}
        >
          Next ›
        </Link>
      )}

      <div className={styles.segment} role="group" aria-label="Audio">
        <button
          className={`${styles.button} ${audio === "sub" ? styles.selected : ""}`}
          aria-pressed={audio === "sub"}
          disabled={!hasSub}
          onClick={() => {
            if (audio !== "sub")
              window.location.href = `/watch/${anilistId}?ep=${episode}&audio=sub`;
          }}
        >
          SUB
        </button>
        <button
          className={`${styles.button} ${audio === "dub" ? styles.selected : ""}`}
          aria-pressed={audio === "dub"}
          disabled={!hasDub}
          onClick={() => {
            if (audio !== "dub")
              window.location.href = `/watch/${anilistId}?ep=${episode}&audio=dub`;
          }}
        >
          DUB
        </button>
      </div>

      <div className={styles.segment} role="group" aria-label="Servers">
        {servers.map((server) => (
          <button
            key={server.id}
            className={`${styles.button} ${
              server.id === state.activeProvider ? styles.selected : ""
            }`}
            aria-pressed={server.id === state.activeProvider}
            onClick={() => state.selectServer(server.id)}
          >
            {server.label || server.id}
          </button>
        ))}
      </div>

      {state.status === "error" && (
        <button className={styles.button} onClick={state.retry}>
          Retry ({state.errorMessage})
        </button>
      )}
    </div>
  );
}
