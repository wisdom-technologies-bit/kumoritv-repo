"use client";

// `?toastdebug=1` status chip (bottom-left, small). It answers the owner's one
// question - "why did nothing appear?" - without a devtools console on a phone:
// flag, setting, path suppression, last poll, cursor, items seen, and the
// reason for the last decision. The button renders a fake item through the real
// toast component, so the visual half can be checked in one tap.

import type { ToastDecisionReason } from "./debug";
import styles from "./component.module.css";

export type ToastDiagnostics = {
  lastPollAt: number | null;
  lastStatus: "none" | "200" | "304" | "429" | "error";
  cursor: string | null;
  itemsSeen: number;
  reason: ToastDecisionReason;
  suppressedPath: boolean;
  /** Which account the browser thinks it is. "guest" when signed out. */
  viewer: string | null;
};

function clock(at: number | null): string {
  if (!at) return "never";
  return new Date(at).toLocaleTimeString(undefined, { hour12: false });
}

/** The owner's phone often has two accounts: show WHICH one is asking. */
function account(viewer: string | null): string {
  if (!viewer) return "guest";
  return `signed in ${viewer.slice(0, 8)}`;
}

export default function ToastDebugChip({
  enabled,
  settingOn,
  pathname,
  diagnostics,
  onSample,
}: {
  enabled: boolean;
  settingOn: boolean;
  pathname: string | null;
  diagnostics: ToastDiagnostics;
  onSample: () => void;
}) {
  return (
    <aside className={styles.debug} data-testid="toast-debug" aria-label="Toast diagnostics">
      <p className={styles.debug_row}>
        <strong>toast</strong> enabled {enabled ? "on" : "off"} · setting {settingOn ? "on" : "off"} · path{" "}
        {diagnostics.suppressedPath ? "suppressed" : "ok"} · {account(diagnostics.viewer)}
      </p>
      <p className={styles.debug_row} data-testid="toast-debug-poll">
        poll {clock(diagnostics.lastPollAt)} · {diagnostics.lastStatus} · items {diagnostics.itemsSeen}
      </p>
      <p className={styles.debug_row} data-testid="toast-debug-cursor">
        cursor {diagnostics.cursor ?? "none"}
      </p>
      <p className={styles.debug_row} data-testid="toast-debug-reason">
        no toast: {diagnostics.reason} · {pathname ?? "/"}
      </p>
      <button type="button" className={styles.debug_button} onClick={onSample} data-testid="toast-debug-sample">
        Show a sample toast
      </button>
    </aside>
  );
}
