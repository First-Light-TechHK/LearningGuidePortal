"use client";

import { useId, useState, type ReactNode } from "react";
import styles from "./course-detail.module.css";

export function CourseCurriculumDisclosure({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  const [expanded, setExpanded] = useState(true);
  const contentId = useId();
  return <div className={styles.disclosure} data-expanded={expanded}>
    <button type="button" className={styles.curriculumToggle} aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded(value => !value)}>
      {summary}
    </button>
    <div id={contentId} className={styles.curriculumBody} aria-hidden={!expanded} inert={!expanded}>
      <div className={styles.curriculumClip}>{children}</div>
    </div>
  </div>;
}
