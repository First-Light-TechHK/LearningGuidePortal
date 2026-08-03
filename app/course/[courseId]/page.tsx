"use client";

import { AppShell } from "@/components/AppShell";

export default function CoursePage() {
  return (
    <AppShell>
      <div className="course-empty">
        <h1>Course Knowledge Base</h1>
        <p className="subtitle">Select or create a knowledge page to continue.</p>
      </div>
    </AppShell>
  );
}
