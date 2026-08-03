import path from "path";
import { atomicWriteJson, ensureDir, ensureInside, now, readJson, readText, removeDir, safeSegment, writeText } from "./fileStore";
import { getCourse } from "./courseStore";
import { getKnowledge, knowledgeDir } from "./knowledgeStore";
import { getWikiPage } from "./wikiStore";

export type PublishedRelease = {
  id: string;
  courseId: string;
  courseTitle: string;
  knowledgeId: string;
  knowledgeTitle: string;
  revisionNotes: string;
  fileName: string;
  filePath: string;
  publishedAt: string;
};

type ReleaseIndex = { releases: PublishedRelease[] };
type LegacyRelease = {
  releaseId?: string;
  id?: string;
  revisionNotes?: string;
  markdownFile?: string;
  fileName?: string;
  createdAt?: string;
  publishedAt?: string;
};

function releasesDir(courseId: string, knowledgeId: string) {
  return path.join(knowledgeDir(courseId, knowledgeId), "releases");
}

function releasesJsonPath(courseId: string, knowledgeId: string) {
  return path.join(releasesDir(courseId, knowledgeId), "releases.json");
}

function sanitizeReleasePart(value: string) {
  return value
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "Release";
}

function stamp(date = new Date()) {
  const pad = (n: number) => `${n}`.padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}`;
}

function safeReleaseFileName(fileName: string) {
  const base = path.basename(fileName).replace(/\s+/g, "_").replace(/[^a-zA-Z0-9._-]/g, "");
  if (!base || base.includes("..")) throw new Error("Invalid release file name");
  return `${base.replace(/\.md$/i, "")}.md`;
}

async function readReleaseIndex(courseId: string, knowledgeId: string): Promise<ReleaseIndex> {
  const raw = await readJson<ReleaseIndex | LegacyRelease[]>(releasesJsonPath(courseId, knowledgeId), { releases: [] });
  const releases = Array.isArray(raw) ? raw.map((item) => normaliseLegacyRelease(courseId, knowledgeId, item)).filter(Boolean) as PublishedRelease[] : raw.releases || [];
  return { releases: releases.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)) };
}

function normaliseLegacyRelease(courseId: string, knowledgeId: string, item: LegacyRelease): PublishedRelease | null {
  const id = item.id || item.releaseId;
  const fileName = item.fileName || item.markdownFile || (id ? `${id}.md` : "");
  if (!id || !fileName) return null;
  return {
    id,
    courseId,
    courseTitle: sanitizeReleasePart(courseId),
    knowledgeId,
    knowledgeTitle: sanitizeReleasePart(knowledgeId),
    revisionNotes: item.revisionNotes || "",
    fileName: safeReleaseFileName(fileName),
    filePath: path.join("data", "knowledge_system", "courses", courseId, "knowledge", knowledgeId, "releases", safeReleaseFileName(fileName)),
    publishedAt: item.publishedAt || item.createdAt || now()
  };
}

async function writeReleaseIndex(courseId: string, knowledgeId: string, releases: PublishedRelease[]) {
  await ensureDir(releasesDir(courseId, knowledgeId));
  await atomicWriteJson(releasesJsonPath(courseId, knowledgeId), { releases });
}

function renderWikiMarkdown(title: string, entries: { title: string; content: string }[]) {
  return [`# ${title}`, ...entries.map((entry) => `## ${entry.title}\n\n${entry.content}`)].join("\n\n").trim() + "\n";
}

export async function listReleases(courseIdValue: string, knowledgeIdValue: string) {
  const courseId = safeSegment(courseIdValue);
  const knowledgeId = safeSegment(knowledgeIdValue);
  return (await readReleaseIndex(courseId, knowledgeId)).releases;
}

export async function createRelease(courseIdValue: string, knowledgeIdValue: string, revisionNotes: string) {
  const courseId = safeSegment(courseIdValue);
  const knowledgeId = safeSegment(knowledgeIdValue);
  const page = await getWikiPage(courseId, knowledgeId);
  if (!page || !page.entries.length) throw new Error("No wiki content found. Please create a wiki draft first.");

  const course = await getCourse(courseId);
  const knowledge = await getKnowledge(courseId, knowledgeId);
  const courseTitle = course?.title || courseId;
  const knowledgeTitle = knowledge?.title || page.title || knowledgeId;
  const publishedAt = now();
  const baseId = `${sanitizeReleasePart(courseTitle)}_${sanitizeReleasePart(knowledgeTitle)}_${stamp(new Date(publishedAt))}`;
  const existing = await readReleaseIndex(courseId, knowledgeId);
  let releaseId = baseId;
  let suffix = 2;
  while (existing.releases.some((release) => release.id === releaseId)) {
    releaseId = `${baseId}_${suffix}`;
    suffix += 1;
  }

  const fileName = safeReleaseFileName(`${releaseId}.md`);
  const root = releasesDir(courseId, knowledgeId);
  const target = ensureInside(root, path.join(root, fileName));
  const wikiMarkdown = renderWikiMarkdown(page.title, page.entries);
  const markdown = [
    `# ${knowledgeTitle}`,
    "",
    `> Course: ${courseTitle}`,
    `> Knowledge: ${knowledgeTitle}`,
    `> Release ID: ${releaseId}`,
    `> Published At: ${publishedAt}`,
    `> Revision Notes: ${revisionNotes || "No revision notes provided."}`,
    "",
    "---",
    "",
    wikiMarkdown.trim(),
    ""
  ].join("\n");

  await ensureDir(root);
  await writeText(target, markdown);
  const release: PublishedRelease = {
    id: releaseId,
    courseId,
    courseTitle,
    knowledgeId,
    knowledgeTitle,
    revisionNotes,
    fileName,
    filePath: path.join("data", "knowledge_system", "courses", courseId, "knowledge", knowledgeId, "releases", fileName),
    publishedAt
  };
  await writeReleaseIndex(courseId, knowledgeId, [release, ...existing.releases]);
  return release;
}

export async function downloadRelease(courseIdValue: string, knowledgeIdValue: string, releaseIdValue: string) {
  const courseId = safeSegment(courseIdValue);
  const knowledgeId = safeSegment(knowledgeIdValue);
  const releaseId = sanitizeReleasePart(releaseIdValue);
  const release = (await listReleases(courseId, knowledgeId)).find((item) => item.id === releaseId);
  if (!release) throw new Error("Release not found");
  const root = releasesDir(courseId, knowledgeId);
  const fileName = safeReleaseFileName(release.fileName);
  const file = ensureInside(root, path.join(root, fileName));
  return { fileName, content: await readText(file) };
}

export async function deleteRelease(courseIdValue: string, knowledgeIdValue: string, releaseIdValue: string) {
  const courseId = safeSegment(courseIdValue);
  const knowledgeId = safeSegment(knowledgeIdValue);
  const releaseId = sanitizeReleasePart(releaseIdValue);
  const index = await readReleaseIndex(courseId, knowledgeId);
  const release = index.releases.find((item) => item.id === releaseId);
  const remaining = index.releases.filter((item) => item.id !== releaseId);
  if (release) {
    const root = releasesDir(courseId, knowledgeId);
    const file = ensureInside(root, path.join(root, safeReleaseFileName(release.fileName)));
    await removeDir(file);
  }
  await writeReleaseIndex(courseId, knowledgeId, remaining);
  return remaining;
}
