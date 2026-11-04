import type { ReactNode } from "react";
import styles from "./study-groups.module.css";

// The AI Tutor row of the schedule and edit forms. While the course's AI Tutor is
// offline the switch is disabled, so the row says why in words: a reason behind a
// hover shows nothing to someone who clicks the switch (BUG-0299). It is a label
// so that the words toggle a working switch as well.
export function AiTutorSwitchRow({ offline, label, enableText, offlineHint, children }: {
  offline: boolean; label: string; enableText: string; offlineHint: string; children: ReactNode;
}) {
  return (
    <label className={`${styles.switch} ${offline ? styles.switchDisabled : ""}`}>
      <span className={styles.switchLabel}>{label}</span>
      <span className={styles.switchText}>{offline ? offlineHint : enableText}</span>
      {children}
    </label>
  );
}
