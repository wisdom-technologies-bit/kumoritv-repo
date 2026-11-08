"use client";

// Prompt 30: the controls row, restyled. Same behaviour, same buttons, same
// text, same ids:
//   - audio is ONE segmented control (SUB | DUB) with glyphs,
//   - servers are a labelled group of pill chips (server names only, never a
//     provider name),
//   - "Backup server" is a toggle-switch pill that still calls
//     state.backupServer and still carries data-testid="backup-server",
//   - "Retry (...)" keeps its text and handler as a small warning pill,
//   - a dismissible notice explains the servers (dismissal is remembered).
//
// Prev / Next moved to the player toolbar (same links, same rules).

import { useEffect, useState } from "react";
import styles from "./component.module.css";
import { useWatchState } from "../WatchState";
import { friendlyWatchError, watchErrorCode } from "@/app/lib/watch/errors";

export const SERVER_NOTICE_KEY = "kumori:server-notice-dismissed";

const NOTICE_TEXT =
  "Video not loading or out of sync? Try another server, or use Backup server.";

function CaptionsIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M1 4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2zm2-1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1z" />
      <path d="M4.5 6.5h2a.5.5 0 0 1 0 1h-2a.5.5 0 0 1 0-1m5 0h2a.5.5 0 0 1 0 1h-2a.5.5 0 0 1 0-1m-5 2h2a.5.5 0 0 1 0 1h-2a.5.5 0 0 1 0-1m5 0h2a.5.5 0 0 1 0 1h-2a.5.5 0 0 1 0-1" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3.5 6.5A.5.5 0 0 1 4 7v1a4 4 0 0 0 8 0V7a.5.5 0 0 1 1 0v1a5 5 0 0 1-4.5 4.975V15h3a.5.5 0 0 1 0 1h-7a.5.5 0 0 1 0-1h3v-2.025A5 5 0 0 1 3 8V7a.5.5 0 0 1 .5-.5" />
      <path d="M10 8a2 2 0 1 1-4 0V3a2 2 0 1 1 4 0zM8 0a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V3a3 3 0 0 0-3-3" />
    </svg>
  );
}

export default function WatchControls({
  anilistId,
  episode,
  audio,
}: {
  anilistId: number;
  episode: number;
  audio: "sub" | "dub";
  episodeCount?: number | null;
}) {
  const state = useWatchState();
  const hasSub = state.availableAudio.sub !== false;
  const hasDub = state.availableAudio.dub !== false;
  // Server buttons carry server names only, never a provider name.
  const servers = state.servers;
  const showServers = servers.length > 0 || state.hasBackup;

  const [noticeDismissed, setNoticeDismissed] = useState(true);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(SERVER_NOTICE_KEY) === "true";
    } catch {
      dismissed = false;
    }
    setNoticeDismissed(dismissed);
  }, []);

  const dismissNotice = () => {
    setNoticeDismissed(true);
    try {
      window.localStorage.setItem(SERVER_NOTICE_KEY, "true");
    } catch {
      /* still hidden for this visit */
    }
  };

  return (
    <div className={styles.wrapper} data-testid="watch-controls">
      {showServers && !noticeDismissed ? (
        <div className={styles.notice}>
          <svg
            viewBox="0 0 16 16"
            width="16"
            height="16"
            fill="currentColor"
            aria-hidden="true"
            focusable="false"
            className={styles.notice_icon}
          >
            <path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16m.93-9.412-1 4.705c-.07.34.029.533.304.533.194 0 .487-.07.686-.246l-.088.416c-.287.346-.92.598-1.465.598-.703 0-1.002-.422-.808-1.319l.738-3.468c.064-.293.006-.399-.287-.47l-.451-.081.082-.381 2.29-.287zM8 5.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2" />
          </svg>

          <p>{NOTICE_TEXT}</p>

          <button
            type="button"
            className={styles.notice_close}
            aria-label="Dismiss notice"
            onClick={dismissNotice}
          >
            <svg
              viewBox="0 0 16 16"
              width="14"
              height="14"
              fill="currentColor"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z" />
            </svg>
          </button>
        </div>
      ) : null}

      <div className={styles.row}>
        <div className={styles.segment} role="group" aria-label="Audio">
          <button
            type="button"
            className={`${styles.segment_button} ${
              audio === "sub" ? styles.selected : ""
            }`}
            aria-pressed={audio === "sub"}
            disabled={!hasSub}
            title={hasSub ? "Japanese audio with subtitles" : "No sub available for this episode"}
            onClick={() => {
              if (audio !== "sub")
                window.location.href = `/watch/${anilistId}?ep=${episode}&audio=sub`;
            }}
          >
            <CaptionsIcon />
            <span>SUB</span>
          </button>
          <button
            type="button"
            className={`${styles.segment_button} ${
              audio === "dub" ? styles.selected : ""
            }`}
            aria-pressed={audio === "dub"}
            disabled={!hasDub}
            title={hasDub ? "English audio" : "No dub available for this episode"}
            onClick={() => {
              if (audio !== "dub")
                window.location.href = `/watch/${anilistId}?ep=${episode}&audio=dub`;
            }}
          >
            <MicIcon />
            <span>DUB</span>
          </button>
        </div>

        {showServers ? (
          <div className={styles.server_group} role="group" aria-label="Servers">
            <span className={styles.group_label} aria-hidden="true">
              Server
            </span>

            {servers.map((server) => (
              <button
                key={server.id}
                type="button"
                className={`${styles.chip} ${
                  server.id === state.activeServerId ? styles.selected : ""
                }`}
                aria-pressed={server.id === state.activeServerId}
                onClick={() => state.selectServer(server.id)}
              >
                {server.label || server.id}
              </button>
            ))}

            {state.hasBackup ? (
              <button
                type="button"
                className={styles.backup_button}
                onClick={state.backupServer}
                data-testid="backup-server"
              >
                <span className={styles.switch} aria-hidden="true">
                  <span className={styles.switch_knob} />
                </span>
                <span>Backup server</span>
              </button>
            ) : null}
          </div>
        ) : null}

        {state.status === "error" ? (
          /* Friendly label only - the raw message lives in the title attribute
             and a data attribute, never in the visible text. */
          <button
            type="button"
            className={styles.retry}
            onClick={state.retry}
            data-error-code={watchErrorCode(state.errorMessage)}
            title={friendlyWatchError(state.errorMessage)}
          >
            Retry
          </button>
        ) : null}
      </div>
    </div>
  );
}
