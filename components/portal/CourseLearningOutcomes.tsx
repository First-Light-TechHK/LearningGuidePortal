import React from "react";

export function CourseLearningOutcomes({ className, title, outcomes }: { className?: string; title: string; outcomes: readonly string[] }) {
  if (!outcomes.length) return null;
  return (
    <div className={className} data-course-outcomes="stored">
      <h3>{title}</h3>
      <ul>{outcomes.map((outcome) => <li key={outcome}>{outcome}</li>)}</ul>
    </div>
  );
}
