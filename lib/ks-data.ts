import { mkdir, readFile, rename, readdir, stat, unlink, writeFile } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { knowledgeDir } from "@/services/knowledgeStore";
import { DEFAULT_COURSE_ID, DEFAULT_KNOWLEDGE_ID, ensureDefaultData } from "@/services/courseStore";

export const DATA_ROOT = knowledgeDir(DEFAULT_COURSE_ID, DEFAULT_KNOWLEDGE_ID);
export const SOURCE_ROOT = path.join(DATA_ROOT, "source_materials");
export const WIKI_ROOT = path.join(DATA_ROOT, "wiki");
export const RELEASE_ROOT = path.join(DATA_ROOT, "releases");

export type SourceManifest = {
  files: StoredFile[];
  qaNotes: StoredFile | null;
  videos: VideoLink[];
  updatedAt: string;
};

export type StoredFile = {
  id: string;
  originalName: string;
  storedName: string;
  relativePath: string;
  size: number;
  type: string;
  uploadedAt: string;
};

export type VideoLink = {
  id: string;
  url: string;
  addedAt: string;
};

export type WikiPage = {
  id: string;
  title: string;
  status: "Draft" | "Published";
  sections: Record<string, string>;
  updatedAt: string;
};

export type WikiComment = {
  id: string;
  pageId: string;
  sectionKey: string;
  text: string;
  createdAt: string;
};

export type ReleaseItem = {
  releaseId: string;
  revisionNotes: string;
  markdownFile: string;
  createdAt: string;
};

const defaultSections = {
  definition:
    "Desire is the fundamental motion of the soul towards what is perceived as good or beneficial. Epicurus holds that while some desires are natural, others are neither natural nor necessary, and these should be guided by reason.",
  keyPoints:
    "- All desires can be classified into three categories: natural and necessary, natural but unnecessary, and neither natural nor necessary.\n- Pleasure and pain are the primary motivators of our desires.\n- Properly ordered desires lead to tranquillity of mind, known as ataraxia.\n- Balanced desire fosters stable happiness and helps promote pleasure ([Pleasure]) and ([Friendship]).",
  misunderstandings:
    "- Misconception: Epicurus advocated unrestrained indulgence.\n- Clarification: He advocated simple, natural pleasures and freedom from bodily pain.",
  teachingExample:
    "Example: When updating our smartphones, we may be driven by natural and necessary desires, natural but unnecessary desires, or unnecessary desires entirely. Analysing our own choices encourages us to practise moderation.",
  followUpQuestions:
    "- Are all non-essential desires problematic for students?\n- How should teachers guide students in aligning their desires with natural and necessary ones?\n- How do ([Pleasure]) and ([Friendship]) relate to the management of desires?"
};

export function id(prefix = "id") {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

export function safeName(name: string) {
  const base = path.basename(name).replace(/\s+/g, "_").replace(/[^a-zA-Z0-9._-]/g, "");
  if (!base || base.includes("..")) throw new Error("Invalid file name");
  return base.slice(0, 140);
}

export function ensureInside(root: string, target: string) {
  const resolved = path.resolve(target);
  const base = path.resolve(root);
  if (!resolved.startsWith(base)) throw new Error("Invalid path");
  return resolved;
}

export function assertAllowedFile(name: string) {
  const ext = path.extname(name).toLowerCase();
  if (![".pdf", ".txt", ".doc", ".docx"].includes(ext)) {
    throw new Error("Unsupported file type");
  }
}

export async function ensureDirs() {
  await ensureDefaultData();
  await Promise.all([
    mkdir(path.join(SOURCE_ROOT, "files"), { recursive: true }),
    mkdir(path.join(SOURCE_ROOT, "qa_notes"), { recursive: true }),
    mkdir(WIKI_ROOT, { recursive: true }),
    mkdir(RELEASE_ROOT, { recursive: true })
  ]);
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const text = await readFile(file, "utf8");
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export async function atomicWriteJson(file: string, data: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}

export async function getSources(): Promise<SourceManifest> {
  await ensureDirs();
  return readJson(path.join(SOURCE_ROOT, "manifest.json"), {
    files: [],
    qaNotes: null,
    videos: [],
    updatedAt: new Date().toISOString()
  });
}

export async function saveSources(manifest: SourceManifest) {
  manifest.updatedAt = new Date().toISOString();
  await atomicWriteJson(path.join(SOURCE_ROOT, "manifest.json"), manifest);
}

export async function saveUpload(file: File, bucket: "files" | "qa_notes") {
  assertAllowedFile(file.name);
  const originalName = safeName(file.name);
  const storedName = `${Date.now()}_${id("file")}_${originalName}`;
  const target = ensureInside(SOURCE_ROOT, path.join(SOURCE_ROOT, bucket, storedName));
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(target, buffer);
  return {
    id: id("upload"),
    originalName,
    storedName,
    relativePath: `source_materials/${bucket}/${storedName}`,
    size: buffer.length,
    type: file.type || path.extname(originalName).slice(1),
    uploadedAt: new Date().toISOString()
  } satisfies StoredFile;
}

export async function getPagesManifest() {
  await ensureDirs();
  return readJson(path.join(WIKI_ROOT, "pages.json"), {
    pages: [
      { id: "overview", title: "Overview" },
      { id: "pleasure", title: "Pleasure" },
      { id: "desire", title: "Desire" },
      { id: "friendship", title: "Friendship" },
      { id: "death", title: "Death" }
    ]
  });
}

export async function savePagesManifest(manifest: { pages: { id: string; title: string }[] }) {
  await atomicWriteJson(path.join(WIKI_ROOT, "pages.json"), manifest);
}

export async function getWikiPage(pageId: string): Promise<WikiPage> {
  const safeId = safeName(pageId).replace(/\.[^.]+$/, "");
  const file = ensureInside(WIKI_ROOT, path.join(WIKI_ROOT, `${safeId}.json`));
  const page = await readJson<WikiPage | null>(file, null);
  if (page) return page;
  const title = safeId === "desire" ? "Desire" : safeId.replace(/^\w/, (c) => c.toUpperCase());
  return { id: safeId, title, status: "Draft", sections: defaultSections, updatedAt: new Date().toISOString() };
}

export async function saveWikiPage(page: WikiPage) {
  const safeId = safeName(page.id).replace(/\.[^.]+$/, "");
  const file = ensureInside(WIKI_ROOT, path.join(WIKI_ROOT, `${safeId}.json`));
  await atomicWriteJson(file, { ...page, id: safeId, updatedAt: new Date().toISOString() });
}

export async function deleteWikiPage(pageId: string) {
  const safeId = safeName(pageId).replace(/\.[^.]+$/, "");
  const file = ensureInside(WIKI_ROOT, path.join(WIKI_ROOT, `${safeId}.json`));
  try {
    await unlink(file);
  } catch {}
  const manifest = await getPagesManifest();
  await savePagesManifest({ pages: manifest.pages.filter((page: { id: string }) => page.id !== safeId) });
}

export async function getComments(): Promise<WikiComment[]> {
  await ensureDirs();
  return readJson(path.join(WIKI_ROOT, "comments.json"), []);
}

export async function saveComments(comments: WikiComment[]) {
  await atomicWriteJson(path.join(WIKI_ROOT, "comments.json"), comments);
}

export async function getReleases(): Promise<ReleaseItem[]> {
  await ensureDirs();
  return readJson(path.join(RELEASE_ROOT, "releases.json"), []);
}

export async function saveReleases(releases: ReleaseItem[]) {
  await atomicWriteJson(path.join(RELEASE_ROOT, "releases.json"), releases);
}

export async function listSourceFiles() {
  const sources = await getSources();
  return [...sources.files, ...(sources.qaNotes ? [sources.qaNotes] : [])];
}

export async function fileExists(relativePath: string) {
  const full = ensureInside(DATA_ROOT, path.join(DATA_ROOT, relativePath));
  try {
    await stat(full);
    return full;
  } catch {
    return null;
  }
}

export async function clearBucket(bucket: "files" | "qa_notes") {
  const dir = ensureInside(SOURCE_ROOT, path.join(SOURCE_ROOT, bucket));
  try {
    const names = await readdir(dir);
    await Promise.all(names.map((name) => unlink(ensureInside(dir, path.join(dir, name))).catch(() => undefined)));
  } catch {}
}

export function renderMarkdown(page: WikiPage, revisionNotes: string) {
  return `# ${page.title}\n\nStatus: ${page.status}\nCourse: Epicureanism\nRevision Notes: ${revisionNotes || "No revision notes provided."}\n\n## 1. Definition\n\n${page.sections.definition || ""}\n\n## 2. Key Points\n\n${page.sections.keyPoints || ""}\n\n## 3. Common Misunderstandings\n\n${page.sections.misunderstandings || ""}\n\n## 4. Teaching Example\n\n${page.sections.teachingExample || ""}\n\n## 5. Follow-up Questions\n\n${page.sections.followUpQuestions || ""}\n`;
}
