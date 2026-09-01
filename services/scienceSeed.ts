import path from "path";
import { copyFile, readFile } from "fs/promises";
import { atomicWriteJson, COURSES_ROOT, ensureDir, now, readJson } from "./fileStore";
import { Course, courseDir, getCourse, saveCourse } from "./courseStore";
import { createKnowledge, ensureKnowledgeDirs, getKnowledge, knowledgeDir } from "./knowledgeStore";
import { createWikiFromImportSourceOutput, getWikiPage } from "./wikiStore";
import { createRelease, listReleases } from "./releaseStore";
import { savePromptSettings, saveRouteConfig } from "./chatTestingStore";
import {
  SCIENCE_DISPLAY_CONTRACT,
  SCIENCE_FIELDS,
  SCIENCE_LECTURE_OVERLAY,
  SCIENCE_SEED_VERSION,
  SCIENCE_SOCRATIC_OVERLAY,
  SCIENCE_TOPICS,
  type ScienceFieldId,
  type ScienceTopic
} from "./scienceTopics";

type SeedRecord = { version: number; updatedAt: string };

function seedPath() {
  return path.join(COURSES_ROOT, "science_seed.json");
}

async function readBasePrompt() {
  try {
    return (await readFile(path.join(process.cwd(), "prompts", "chat_testing", "BasePrompt"), "utf8")).trim();
  } catch {
    return "You are an AI tutor helping students learn.";
  }
}

async function writeCourseIndex(courseIds: string[]) {
  const unique = [...new Set(courseIds)];
  await atomicWriteJson(path.join(COURSES_ROOT, "course_index.json"), { courseIds: unique });
}

async function ensureFieldCourse(fieldId: ScienceFieldId, title: string) {
  const existing = await getCourse(fieldId);
  if (existing) {
    if (existing.title !== title) {
      existing.title = title;
      await saveCourse(existing);
    }
    return existing;
  }
  const time = now();
  const course: Course = {
    id: fieldId,
    title,
    knowledgeIds: [],
    createdAt: time,
    updatedAt: time
  };
  await ensureDir(courseDir(fieldId));
  await atomicWriteJson(path.join(courseDir(fieldId), "course.json"), course);
  return course;
}

async function ensureTopicKnowledge(course: Course, topicId: string, title: string) {
  const existing = await getKnowledge(course.id, topicId);
  if (existing) {
    if (existing.title !== title || existing.status !== "Published" || existing.courseId !== course.id) {
      existing.title = title;
      existing.status = "Published";
      existing.courseId = course.id;
      existing.updatedAt = now();
      await atomicWriteJson(path.join(knowledgeDir(course.id, topicId), "knowledge.json"), existing);
    }
    if (!course.knowledgeIds.includes(topicId)) {
      course.knowledgeIds.push(topicId);
      await saveCourse(course);
    }
    return existing;
  }

  await ensureKnowledgeDirs(course.id, topicId);
  try {
    const created = await createKnowledge(course.id, title);
    created.status = "Published";
    created.updatedAt = now();
    await atomicWriteJson(path.join(knowledgeDir(course.id, created.id), "knowledge.json"), created);
    return created;
  } catch {
    const time = now();
    const knowledge = {
      id: topicId,
      courseId: course.id,
      title,
      status: "Published" as const,
      createdAt: time,
      updatedAt: time
    };
    await atomicWriteJson(path.join(knowledgeDir(course.id, topicId), "knowledge.json"), knowledge);
    if (!course.knowledgeIds.includes(topicId)) {
      course.knowledgeIds.push(topicId);
      await saveCourse(course);
    }
    return knowledge;
  }
}

function workspaceRoot() {
  const cwd = process.cwd();
  return path.basename(cwd) === "LearningGuide" ? path.resolve(cwd, "..") : cwd;
}

async function registerSourceFiles(courseId: string, knowledgeId: string, topic: ScienceTopic) {
  const filesDir = path.join(knowledgeDir(courseId, knowledgeId), "source_materials", "files");
  await ensureDir(filesDir);
  const root = workspaceRoot();
  const files = [];
  for (const source of topic.sourceFiles) {
    const from = path.join(root, source.from);
    const storedName = source.originalName;
    await copyFile(from, path.join(filesDir, storedName));
    const stat = await readFile(from);
    files.push({
      id: `source_${knowledgeId}_${storedName.replace(/[^a-z0-9]+/gi, "_")}`,
      originalName: storedName,
      storedName,
      relativePath: `source_materials/files/${storedName}`,
      size: stat.byteLength,
      type: path.extname(storedName).slice(1),
      uploadedAt: now()
    });
  }
  await atomicWriteJson(path.join(knowledgeDir(courseId, knowledgeId), "source_materials", "manifest.json"), {
    files,
    qaNotes: null,
    videos: [],
    updatedAt: now()
  });
}

async function seedTopic(course: Course, topic: ScienceTopic, force: boolean) {
  const knowledge = await ensureTopicKnowledge(course, topic.id, topic.title);
  await registerSourceFiles(course.id, knowledge.id, topic);
  const page = await getWikiPage(course.id, knowledge.id);
  if (force || !page?.entries?.length) {
    await createWikiFromImportSourceOutput(course.id, knowledge.id, topic.wikiMarkdown);
  }

  let releases = await listReleases(course.id, knowledge.id);
  if (force || !releases.length) {
    await createRelease(course.id, knowledge.id, `Science seed v${SCIENCE_SEED_VERSION}: field ${topic.field}, source figures.`);
    releases = await listReleases(course.id, knowledge.id);
  }

  const basePrompt = `${await readBasePrompt()}\n\n${SCIENCE_DISPLAY_CONTRACT}`;
  await savePromptSettings(course.id, knowledge.id, {
    basePrompt,
    lecturePrompt: SCIENCE_LECTURE_OVERLAY,
    socraticPrompt: SCIENCE_SOCRATIC_OVERLAY,
    assessmentPrompt: ""
  });

  const latest = releases[0];
  if (latest) {
    await saveRouteConfig(course.id, knowledge.id, [
      {
        id: `${course.id}_${knowledge.id}_primary`,
        useKnowledge: true,
        releaseId: latest.id
      }
    ]);
  }
}

export async function ensureScienceTopics() {
  const record = await readJson<SeedRecord | null>(seedPath(), null);
  const force = record?.version !== SCIENCE_SEED_VERSION;
  const fieldCourses = new Map<ScienceFieldId, Course>();
  for (const field of SCIENCE_FIELDS) {
    fieldCourses.set(field.id, await ensureFieldCourse(field.id, field.title));
  }

  for (const topic of SCIENCE_TOPICS) {
    const course = fieldCourses.get(topic.field);
    if (!course) throw new Error(`Missing field course for ${topic.field}`);
    await seedTopic(course, topic, force);
  }

  for (const field of SCIENCE_FIELDS) {
    const course = await getCourse(field.id);
    if (!course) continue;
    const ordered = SCIENCE_TOPICS.filter((topic) => topic.field === field.id).map((topic) => topic.id);
    const extras = course.knowledgeIds.filter((id) => !ordered.includes(id));
    course.knowledgeIds = [...ordered, ...extras];
    course.title = field.title;
    await saveCourse(course);
  }

  const index = await readJson<{ courseIds: string[] }>(path.join(COURSES_ROOT, "course_index.json"), { courseIds: [] });
  const fieldIds = SCIENCE_FIELDS.map((field) => field.id);
  const rest = index.courseIds.filter((id) => !fieldIds.includes(id as ScienceFieldId) && id !== "science");
  await writeCourseIndex([...fieldIds, ...rest]);
  await atomicWriteJson(seedPath(), { version: SCIENCE_SEED_VERSION, updatedAt: now() });
}
