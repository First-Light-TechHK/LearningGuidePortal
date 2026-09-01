"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Lesson = { id: string; title: string; body: string; durationMinutes: number; isPublic: boolean };
type Course = { id: string; title: string; description: string; status: "draft" | "published"; slug: string; sections: Array<{ id: string; title: string; lessons: Lesson[] }> };

type Copy = {
  title: string;
  courses: string;
  courseTitle: string;
  description: string;
  create: string;
  lessons: string;
  lessonTitle: string;
  lessonBody: string;
  durationMinutes: string;
  publicLesson: string;
  addLesson: string;
  noLessons: string;
  draft: string;
  published: string;
  publish: string;
  unpublish: string;
};

export function CourseManager({ copy }: { copy: Copy }) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [lessonTitle, setLessonTitle] = useState("");
  const [lessonBody, setLessonBody] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("20");
  const [isPublic, setIsPublic] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch("/api/backoffice/courses", { cache: "no-store" });
    const data = await response.json() as { courses?: Course[]; error?: string };
    if (!response.ok) throw new Error(data.error || "Course Management could not be loaded.");
    setCourses(data.courses || []);
    setSelectedCourseId((current) => current || data.courses?.[0]?.id || "");
  }

  useEffect(() => { void load().catch((requestError) => setError(requestError instanceof Error ? requestError.message : "Course Management could not be loaded.")); }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/backoffice/courses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, description }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Create failed.");
      setTitle("");
      setDescription("");
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Create failed.");
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus(course: Course) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/backoffice/courses/${course.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: course.status === "published" ? "draft" : "published" }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Course status update failed.");
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Course status update failed.");
    } finally {
      setBusy(false);
    }
  }

  async function addLesson(event: FormEvent) {
    event.preventDefault();
    if (!selectedCourseId) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/backoffice/courses/${selectedCourseId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: lessonTitle, body: lessonBody, durationMinutes: Number(durationMinutes), isPublic }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Lesson creation failed.");
      setLessonTitle("");
      setLessonBody("");
      setDurationMinutes("20");
      setIsPublic(false);
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Lesson creation failed.");
    } finally {
      setBusy(false);
    }
  }

  const selectedCourse = useMemo(() => courses.find((course) => course.id === selectedCourseId) || null, [courses, selectedCourseId]);
  return (
    <section className="backoffice-panel">
      <p className="portal-eyebrow">{copy.title}</p>
      <h1>{copy.courses}</h1>
      <form className="backoffice-form" onSubmit={create}>
        <label>{copy.courseTitle}<input value={title} onChange={(event) => setTitle(event.target.value)} required /></label>
        <label>{copy.description}<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} /></label>
        <button className="portal-button portal-button-primary" disabled={busy}>{copy.create}</button>
      </form>
      {error ? <p className="portal-form-error" role="alert">{error}</p> : null}
      <div className="backoffice-course-list">
        {courses.map((course) => {
          const lessons = course.sections.flatMap((section) => section.lessons);
          return <article className={`backoffice-course-row ${selectedCourseId === course.id ? "selected" : ""}`} key={course.id}>
            <div>
              <strong>{course.title}</strong>
              <span>{course.status === "published" ? copy.published : copy.draft} · {lessons.length} {copy.lessons.toLowerCase()}</span>
              {lessons.length ? <ul className="backoffice-lesson-list">{lessons.map((lesson) => <li key={lesson.id}>{lesson.title}{lesson.isPublic ? ` · ${copy.publicLesson}` : ""}</li>)}</ul> : <span>{copy.noLessons}</span>}
            </div>
            <div className="backoffice-row-actions">
              <button className="portal-button portal-button-secondary" onClick={() => setSelectedCourseId(course.id)} type="button">{copy.addLesson}</button>
              <button className="portal-button portal-button-secondary" disabled={busy} onClick={() => void updateStatus(course)} type="button">{course.status === "published" ? copy.unpublish : copy.publish}</button>
            </div>
          </article>;
        })}
      </div>
      {selectedCourse ? <form className="backoffice-form lesson-form" onSubmit={addLesson}>
        <h2>{copy.addLesson}: {selectedCourse.title}</h2>
        <label>{copy.lessonTitle}<input value={lessonTitle} onChange={(event) => setLessonTitle(event.target.value)} required /></label>
        <label>{copy.lessonBody}<textarea value={lessonBody} onChange={(event) => setLessonBody(event.target.value)} rows={8} required /></label>
        <label>{copy.durationMinutes}<input type="number" min="1" max="600" value={durationMinutes} onChange={(event) => setDurationMinutes(event.target.value)} required /></label>
        <label className="backoffice-checkbox"><input type="checkbox" checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} />{copy.publicLesson}</label>
        <button className="portal-button portal-button-primary" disabled={busy}>{copy.addLesson}</button>
      </form> : null}
    </section>
  );
}
