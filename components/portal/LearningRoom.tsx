"use client";

import { useEffect, useState } from "react";
import { TutorChat } from "./TutorChat";

export function LearningRoom({ locale, courseId, lesson, copy }: { locale: "en-GB" | "zh-CN"; courseId: string; lesson: { id: string; title: string; body: string; durationMinutes: number }; copy: { study: string; minutes: string; you: string; completeLesson: string; completed: string; tutor: string; lecture: string; socratic: string; send: string; askTutor: string } }) {
  const [completed, setCompleted] = useState(false);
  useEffect(() => { void fetch("/api/study/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ courseId, lessonId: lesson.id, event: "open", seconds: 0, clientEventId: `open_${courseId}_${lesson.id}` }) }); }, [courseId, lesson.id]);
  async function complete() { const response = await fetch("/api/study/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ courseId, lessonId: lesson.id, event: "complete", seconds: lesson.durationMinutes * 60, clientEventId: `complete_${courseId}_${lesson.id}` }) }); if (response.ok) setCompleted(true); }
  return <div className="learning-room"><article className="lesson-content"><p className="portal-eyebrow">{copy.study}</p><h1>{lesson.title}</h1><p className="lesson-duration">{lesson.durationMinutes} {copy.minutes}</p><div className="lesson-body">{lesson.body.split("\n\n").map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div><button className="portal-button portal-button-primary" onClick={complete} disabled={completed}>{completed ? copy.completed : copy.completeLesson}</button></article><TutorChat locale={locale} courseId={courseId} lessonId={lesson.id} copy={copy} /></div>;
}
