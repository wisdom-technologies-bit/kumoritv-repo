"use client";
// The one switch row used by every settings card (playback, content, push).
// Extracted from the settings modal so the Notifications section renders exactly
// the same control, down to the classes and the role="switch" semantics.

import styles from "./component.module.css";

export type SwitchRowProps = {
  id: string;
  name: string;
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
};

export default function SwitchRow({
  id,
  name,
  label,
  description,
  checked,
  disabled = false,
  onChange,
}: SwitchRowProps) {
  return (
    <div className={styles.switch_row} data-disabled={disabled ? "true" : "false"}>
      <label className={styles.switch_text} htmlFor={id}>
        <span className={styles.switch_label}>{label}</span>
        {description && <span className={styles.switch_desc}>{description}</span>}
      </label>

      <span className={styles.switch_control}>
        <input
          id={id}
          type="checkbox"
          role="switch"
          name={name}
          className={styles.switch_input}
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className={styles.switch_track} aria-hidden="true" />
      </span>
    </div>
  );
}
