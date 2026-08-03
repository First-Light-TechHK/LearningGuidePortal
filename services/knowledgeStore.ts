import path from "path";
import { atomicWriteJson, ensureDir, now, readJson, removeDir, safeSegment, slugify } from "./fileStore";
import { courseDir, getCourse, saveCourse } from "./courseStore";

export type Knowledge = {
  id: string;
  courseId: string;
  title: string;
  status: "Draft" | "Published";
  createdAt: string;
  updatedAt: string;
};

export function knowledgeDir(courseId: string, knowledgeId: string) {
  return path.join(courseDir(courseId), "knowledge", safeSegment(knowledgeId));
}

export async function ensureKnowledgeDirs(courseId: string, knowledgeId: string) {
  const root = knowledgeDir(courseId, knowledgeId);
  await Promise.all([
    ensureDir(path.join(root, "source_materials", "files")),
    ensureDir(path.join(root, "source_materials", "qa_notes")),
    ensureDir(path.join(root, "llm_draft")),
    ensureDir(path.join(root, "wiki")),
    ensureDir(path.join(root, "releases"))
  ]);
}

export async function listKnowledge(courseId: string) {
  const course = await getCourse(courseId);
  if (!course) return [];
  const items = await Promise.all(course.knowledgeIds.map((knowledgeId) => getKnowledge(courseId, knowledgeId)));
  return items.filter(Boolean) as Knowledge[];
}

export async function getKnowledge(courseId: string, knowledgeId: string) {
  return readJson<Knowledge | null>(path.join(knowledgeDir(courseId, knowledgeId), "knowledge.json"), null);
}

export async function createKnowledge(courseId: string, title: string) {
  const course = await getCourse(courseId);
  if (!course) throw new Error("Course not found");
  const id = safeSegment(slugify(title));
  if (course.knowledgeIds.includes(id)) throw new Error("Knowledge already exists");
  const time = now();
  const knowledge: Knowledge = { id, courseId, title: title.trim(), status: "Draft", createdAt: time, updatedAt: time };
  await ensureKnowledgeDirs(courseId, id);
  await atomicWriteJson(path.join(knowledgeDir(courseId, id), "knowledge.json"), knowledge);
  course.knowledgeIds.push(id);
  await saveCourse(course);
  return knowledge;
}

export async function renameKnowledge(courseId: string, knowledgeId: string, newTitle: string) {
  const knowledge = await getKnowledge(courseId, knowledgeId);
  if (!knowledge) throw new Error("Knowledge not found");
  knowledge.title = newTitle.trim();
  knowledge.updatedAt = now();
  await atomicWriteJson(path.join(knowledgeDir(courseId, knowledgeId), "knowledge.json"), knowledge);
  return knowledge;
}

export async function deleteKnowledge(courseId: string, knowledgeId: string) {
  const course = await getCourse(courseId);
  if (!course) throw new Error("Course not found");
  await removeDir(knowledgeDir(courseId, knowledgeId));
  course.knowledgeIds = course.knowledgeIds.filter((item) => item !== safeSegment(knowledgeId));
  await saveCourse(course);
}
