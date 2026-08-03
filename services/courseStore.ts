import path from "path";
import { atomicWriteJson, COURSES_ROOT, ensureDir, now, readJson, removeDir, safeSegment, slugify } from "./fileStore";
import { ensureKnowledgeDirs } from "./knowledgeStore";

export type Course = {
  id: string;
  title: string;
  knowledgeIds: string[];
  createdAt: string;
  updatedAt: string;
};

type CourseIndex = { courseIds: string[] };

export const DEFAULT_COURSE_ID = "philosophy";
export const DEFAULT_KNOWLEDGE_ID = "epicureanism";

export function courseDir(courseId: string) {
  return path.join(COURSES_ROOT, safeSegment(courseId));
}

export async function ensureDefaultData() {
  await ensureDir(COURSES_ROOT);
  const index = await readJson<CourseIndex>(path.join(COURSES_ROOT, "course_index.json"), { courseIds: [] });
  if (!index.courseIds.length) {
    const time = now();
    const course: Course = {
      id: DEFAULT_COURSE_ID,
      title: "Philosophy",
      knowledgeIds: [DEFAULT_KNOWLEDGE_ID],
      createdAt: time,
      updatedAt: time
    };
    await ensureDir(courseDir(course.id));
    await atomicWriteJson(path.join(courseDir(course.id), "course.json"), course);
    await atomicWriteJson(path.join(COURSES_ROOT, "course_index.json"), { courseIds: [course.id] });
    await ensureKnowledgeDirs(course.id, DEFAULT_KNOWLEDGE_ID);
    await atomicWriteJson(path.join(courseDir(course.id), "knowledge", DEFAULT_KNOWLEDGE_ID, "knowledge.json"), {
      id: DEFAULT_KNOWLEDGE_ID,
      courseId: course.id,
      title: "Epicureanism",
      status: "Draft",
      createdAt: time,
      updatedAt: time
    });
  }
}

async function readIndex() {
  await ensureDefaultData();
  return readJson<CourseIndex>(path.join(COURSES_ROOT, "course_index.json"), { courseIds: [DEFAULT_COURSE_ID] });
}

async function writeIndex(index: CourseIndex) {
  await atomicWriteJson(path.join(COURSES_ROOT, "course_index.json"), index);
}

export async function listCourses() {
  const index = await readIndex();
  const courses = await Promise.all(index.courseIds.map((courseId) => getCourse(courseId)));
  return courses.filter(Boolean) as Course[];
}

export async function getCourse(courseId: string) {
  await ensureDefaultData();
  return readJson<Course | null>(path.join(courseDir(courseId), "course.json"), null);
}

export async function saveCourse(course: Course) {
  course.updatedAt = now();
  await atomicWriteJson(path.join(courseDir(course.id), "course.json"), course);
}

export async function createCourse(title: string) {
  const id = safeSegment(slugify(title));
  const existing = await getCourse(id);
  if (existing) throw new Error("Course already exists");
  const time = now();
  const course: Course = { id, title: title.trim(), knowledgeIds: [], createdAt: time, updatedAt: time };
  await ensureDir(courseDir(id));
  await atomicWriteJson(path.join(courseDir(id), "course.json"), course);
  const index = await readIndex();
  index.courseIds.push(id);
  await writeIndex({ courseIds: [...new Set(index.courseIds)] });
  return course;
}

export async function renameCourse(courseId: string, newTitle: string) {
  const course = await getCourse(courseId);
  if (!course) throw new Error("Course not found");
  course.title = newTitle.trim();
  await saveCourse(course);
  return course;
}

export async function deleteCourse(courseId: string) {
  const id = safeSegment(courseId);
  await removeDir(courseDir(id));
  const index = await readIndex();
  await writeIndex({ courseIds: index.courseIds.filter((item) => item !== id) });
}
