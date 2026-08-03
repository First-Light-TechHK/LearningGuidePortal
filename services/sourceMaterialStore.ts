import path from "path";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import {
  atomicWriteJson,
  ensureDir,
  ensureInside,
  listDir,
  pathStat,
  readJson,
  removeDir,
  safeSegment,
  writeBinary,
  writeText
} from "./fileStore";
import { knowledgeDir } from "./knowledgeStore";

export type StoredFile = {
  id: string;
  originalName: string;
  storedName: string;
  relativePath: string;
  size: number;
  type: string;
  uploadedAt: string;
};

export type TranscriptStatus = "idle" | "resolving" | "downloading" | "generating" | "saving" | "ready" | "error";

export type VideoLink = {
  id: string;
  videoId: string;
  title: string;
  url: string;
  transcriptStatus: TranscriptStatus;
  rawTranscriptPath?: string;
  semanticTranscriptPath?: string;
  transcriptError?: string;
  addedAt: string;
  createdAt: string;
  updatedAt: string;
};
export type SourceManifest = { files: StoredFile[]; qaNotes: StoredFile | null; videos: VideoLink[]; updatedAt: string };
export type SourceFileType = "file" | "qa_note";

const allowed = [".pdf", ".txt", ".doc", ".docx", ".md"];
const transcriptAllowed = [".json", ".md"];
const execFileAsync = promisify(execFile);

export function sourceRoot(courseId: string, knowledgeId: string) {
  return path.join(knowledgeDir(courseId, knowledgeId), "source_materials");
}

function id(prefix: string) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function cleanFileName(name: string) {
  const base = path.basename(name).replace(/\s+/g, "_").replace(/[^a-zA-Z0-9._-]/g, "");
  if (!base || base.includes("..")) throw new Error("Invalid file name");
  const ext = path.extname(base).toLowerCase();
  if (!allowed.includes(ext)) throw new Error("Unsupported file type");
  return base.slice(0, 140);
}

export function cleanTranscriptTitle(title: string) {
  const base = title.trim().replace(/\s+/g, "_").replace(/[^a-zA-Z0-9._-]/g, "");
  return (base || "youtube_transcript").slice(0, 110);
}

function manifestPath(courseId: string, knowledgeId: string) {
  return path.join(sourceRoot(courseId, knowledgeId), "manifest.json");
}

export async function getSourceMaterials(courseId: string, knowledgeId: string): Promise<SourceManifest> {
  const manifest = await readJson<SourceManifest>(manifestPath(courseId, knowledgeId), {
    files: [],
    qaNotes: null,
    videos: [],
    updatedAt: new Date().toISOString()
  });
  return reconcileManifestWithDisk(courseId, knowledgeId, manifest);
}

export async function saveSourceMaterials(courseId: string, knowledgeId: string, manifest: SourceManifest) {
  manifest.updatedAt = new Date().toISOString();
  manifest.videos = normaliseVideoLinks(manifest.videos);
  await atomicWriteJson(manifestPath(courseId, knowledgeId), manifest);
  await atomicWriteJson(path.join(sourceRoot(courseId, knowledgeId), "videos.json"), manifest.videos);
}

export async function saveFiles(courseId: string, knowledgeId: string, files: File[]) {
  const manifest = await getSourceMaterials(courseId, knowledgeId);
  if (manifest.files.length + files.length > 5) throw new Error("Maximum 5 files");
  for (const file of files) manifest.files.push(await saveOne(courseId, knowledgeId, file, "files"));
  await saveSourceMaterials(courseId, knowledgeId, manifest);
  return manifest;
}

export async function saveQaNotes(courseId: string, knowledgeId: string, file: File) {
  const manifest = await getSourceMaterials(courseId, knowledgeId);
  if (manifest.qaNotes) throw new Error("Maximum 1 Q&A Notes file");
  manifest.qaNotes = await saveOne(courseId, knowledgeId, file, "qa_notes");
  await saveSourceMaterials(courseId, knowledgeId, manifest);
  return manifest;
}

function matchesFileIdentity(file: StoredFile | null | undefined, fileId?: string, storedName?: string, relativePath?: string) {
  if (!file) return false;
  return Boolean(
    (fileId && file.id === fileId) ||
    (storedName && file.storedName === storedName) ||
    (relativePath && file.relativePath === relativePath)
  );
}

function filePathFromManifestRecord(courseId: string, knowledgeId: string, sourceType: SourceFileType, file: StoredFile) {
  const root = sourceRoot(courseId, knowledgeId);
  const bucket = sourceType === "qa_note" ? "qa_notes" : "files";
  const manifestBucket = file.relativePath?.split("/")[1];
  if (manifestBucket && manifestBucket !== bucket) throw new Error("Source material bucket mismatch.");
  const fileName = path.basename(file.storedName || file.relativePath || "");
  if (!fileName || fileName === "." || fileName === "..") throw new Error("Invalid source material file.");
  return ensureInside(root, path.join(root, bucket, fileName));
}

export async function deleteSourceMaterialFile(
  courseId: string,
  knowledgeId: string,
  sourceType: SourceFileType,
  identity: { fileId?: string; storedName?: string; relativePath?: string }
) {
  const rawManifest = await readJson<SourceManifest>(manifestPath(courseId, knowledgeId), {
    files: [],
    qaNotes: null,
    videos: [],
    updatedAt: new Date().toISOString()
  });
  const reconciledManifest = await getSourceMaterials(courseId, knowledgeId);
  const rawFiles = sourceType === "qa_note" ? (rawManifest.qaNotes ? [rawManifest.qaNotes] : []) : rawManifest.files;
  const reconciledFiles = sourceType === "qa_note" ? (reconciledManifest.qaNotes ? [reconciledManifest.qaNotes] : []) : reconciledManifest.files;
  const file = rawFiles.find((item) => matchesFileIdentity(item, identity.fileId, identity.storedName, identity.relativePath))
    || reconciledFiles.find((item) => matchesFileIdentity(item, identity.fileId, identity.storedName, identity.relativePath));

  if (!file) throw new Error("Source material file not found.");

  const target = filePathFromManifestRecord(courseId, knowledgeId, sourceType, file);
  await removeDir(target);

  const nextManifest: SourceManifest = {
    ...reconciledManifest,
    files: sourceType === "file"
      ? reconciledManifest.files.filter((item) => !matchesFileIdentity(item, identity.fileId, file.storedName, file.relativePath))
      : reconciledManifest.files,
    qaNotes: sourceType === "qa_note" && matchesFileIdentity(reconciledManifest.qaNotes, identity.fileId, file.storedName, file.relativePath)
      ? null
      : reconciledManifest.qaNotes
  };

  if (sourceType === "file") {
    nextManifest.files = nextManifest.files.filter((item) => item.storedName !== file.storedName);
  } else if (nextManifest.qaNotes?.storedName === file.storedName) {
    nextManifest.qaNotes = null;
  }

  await saveSourceMaterials(courseId, knowledgeId, nextManifest);
  return nextManifest;
}

async function saveOne(courseId: string, knowledgeId: string, file: File, bucket: "files" | "qa_notes") {
  const originalName = cleanFileName(file.name);
  const storedName = `${Date.now()}_${id("file")}_${originalName}`;
  const target = path.join(sourceRoot(courseId, knowledgeId), bucket, storedName);
  const buffer = Buffer.from(await file.arrayBuffer());
  await ensureDir(path.dirname(target));
  await writeBinary(target, buffer);
  return {
    id: id("upload"),
    originalName,
    storedName,
    relativePath: `source_materials/${bucket}/${storedName}`,
    size: buffer.length,
    type: file.type || path.extname(originalName).slice(1),
    uploadedAt: new Date().toISOString()
  };
}

function originalNameFromStored(storedName: string) {
  return storedName.replace(/^\d+_file_[a-f0-9]+_/, "");
}

async function fileRecordFromDisk(courseId: string, knowledgeId: string, bucket: "files" | "qa_notes", storedName: string, existing?: StoredFile): Promise<StoredFile> {
  const filePath = path.join(sourceRoot(courseId, knowledgeId), bucket, storedName);
  const info = await pathStat(filePath);
  const originalName = existing?.originalName || originalNameFromStored(storedName);
  return {
    id: existing?.id || id("upload"),
    originalName,
    storedName,
    relativePath: `source_materials/${bucket}/${storedName}`,
    size: info.size,
    type: existing?.type || path.extname(originalName).slice(1),
    uploadedAt: existing?.uploadedAt || info.birthtime.toISOString()
  };
}

async function listStoredNames(courseId: string, knowledgeId: string, bucket: "files" | "qa_notes") {
  try {
    const names = await listDir(path.join(sourceRoot(courseId, knowledgeId), bucket));
    return names
      .filter((name) => allowed.includes(path.extname(name).toLowerCase()))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

async function reconcileManifestWithDisk(courseId: string, knowledgeId: string, manifest: SourceManifest): Promise<SourceManifest> {
  const fileNames = await listStoredNames(courseId, knowledgeId, "files");
  const qaNames = await listStoredNames(courseId, knowledgeId, "qa_notes");
  const files = await Promise.all(
    fileNames.map((name) => fileRecordFromDisk(courseId, knowledgeId, "files", name, manifest.files.find((file) => file.storedName === name)))
  );
  const qaName = qaNames[qaNames.length - 1];
  const qaNotes = qaName ? await fileRecordFromDisk(courseId, knowledgeId, "qa_notes", qaName, manifest.qaNotes?.storedName === qaName ? manifest.qaNotes : undefined) : null;
  return { ...manifest, files, qaNotes, videos: normaliseVideoLinks(manifest.videos) };
}

export async function saveVideoLinks(courseId: string, knowledgeId: string, links: VideoLink[]) {
  if (links.length > 5) throw new Error("Maximum 5 video links");
  const manifest = await getSourceMaterials(courseId, knowledgeId);
  manifest.videos = links;
  await saveSourceMaterials(courseId, knowledgeId, manifest);
  return manifest;
}

export function extractYouTubeVideoId(input: string) {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("Enter a valid YouTube URL");
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  let videoId = "";
  if (host === "youtu.be") {
    videoId = url.pathname.split("/").filter(Boolean)[0] || "";
  } else if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    if (url.pathname === "/watch") videoId = url.searchParams.get("v") || "";
    if (!videoId && (url.pathname.startsWith("/embed/") || url.pathname.startsWith("/shorts/"))) {
      videoId = url.pathname.split("/").filter(Boolean)[1] || "";
    }
  }

  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) throw new Error("Enter a valid YouTube URL");
  return videoId;
}

export async function resolveYouTubeMetadata(url: string) {
  const videoId = extractYouTubeVideoId(url);
  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
  try {
    const response = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(canonicalUrl)}`, {
      headers: { Accept: "application/json" }
    });
    if (response.ok) {
      const data = (await response.json()) as { title?: string };
      const title = data.title?.trim();
      if (title) return { videoId, title, url: canonicalUrl };
    }
  } catch {
    // YouTube metadata can be unreachable in local/network-restricted environments.
  }
  const pythonTitle = await resolveYouTubeTitleWithPython(canonicalUrl).catch(() => "");
  if (pythonTitle) return { videoId, title: pythonTitle, url: canonicalUrl };
  return { videoId, title: `YouTube ${videoId}`, url: canonicalUrl };
}

async function resolveYouTubeTitleWithPython(canonicalUrl: string) {
  const python = process.env.YOUTUBE_TRANSCRIPT_API_PYTHON || "python3";
  const script = String.raw`
import json
import sys
import urllib.parse
import urllib.request

oembed_url = "https://www.youtube.com/oembed?format=json&url=" + urllib.parse.quote(sys.argv[1], safe="")
with urllib.request.urlopen(oembed_url, timeout=20) as response:
    data = json.loads(response.read().decode("utf-8"))
print(data.get("title", "").strip())
`;
  const { stdout } = await execFileAsync(python, ["-c", script, canonicalUrl], {
    timeout: 25000,
    maxBuffer: 1024 * 1024
  });
  return stdout.trim().slice(0, 180);
}

function normaliseVideoLinks(links: unknown): VideoLink[] {
  if (!Array.isArray(links)) return [];
  return links.map((raw) => {
    const item = raw as Partial<VideoLink> & { addedAt?: string };
    const nowValue = item.createdAt || item.addedAt || new Date().toISOString();
    let videoId = item.videoId || "";
    try {
      videoId = videoId || extractYouTubeVideoId(item.url || "");
    } catch {
      videoId = "";
    }
    return {
      id: item.id || id("video"),
      videoId,
      title: item.title || item.url || "YouTube video",
      url: item.url || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : ""),
      transcriptStatus: item.transcriptStatus || "idle",
      rawTranscriptPath: item.rawTranscriptPath,
      semanticTranscriptPath: item.semanticTranscriptPath,
      transcriptError: item.transcriptError,
      addedAt: item.addedAt || nowValue,
      createdAt: item.createdAt || nowValue,
      updatedAt: item.updatedAt || nowValue
    };
  });
}

export async function addVideoLink(courseId: string, knowledgeId: string, url: string) {
  const metadata = await resolveYouTubeMetadata(url);
  const manifest = await getSourceMaterials(courseId, knowledgeId);
  if (manifest.videos.length >= 5) throw new Error("Maximum 5 YouTube links");
  if (manifest.videos.some((video) => video.videoId === metadata.videoId)) throw new Error("This YouTube link is already added");
  const nowValue = new Date().toISOString();
  manifest.videos.push({
    id: id("video"),
    videoId: metadata.videoId,
    title: metadata.title,
    url: metadata.url,
    transcriptStatus: "idle",
    addedAt: nowValue,
    createdAt: nowValue,
    updatedAt: nowValue
  });
  await saveSourceMaterials(courseId, knowledgeId, manifest);
  return manifest;
}

export async function deleteVideoLink(courseId: string, knowledgeId: string, videoId: string) {
  const manifest = await getSourceMaterials(courseId, knowledgeId);
  const video = manifest.videos.find((item) => item.id === videoId);
  await Promise.all([
    video?.rawTranscriptPath ? deleteTranscriptFile(courseId, knowledgeId, video.rawTranscriptPath) : Promise.resolve(),
    video?.semanticTranscriptPath ? deleteTranscriptFile(courseId, knowledgeId, video.semanticTranscriptPath) : Promise.resolve()
  ]);
  manifest.videos = manifest.videos.filter((video) => video.id !== videoId);
  await saveSourceMaterials(courseId, knowledgeId, manifest);
  return manifest;
}

export async function updateVideoLink(courseId: string, knowledgeId: string, videoId: string, patch: Partial<VideoLink>) {
  const manifest = await getSourceMaterials(courseId, knowledgeId);
  const index = manifest.videos.findIndex((video) => video.id === videoId);
  if (index < 0) throw new Error("YouTube link not found");
  manifest.videos[index] = { ...manifest.videos[index], ...patch, updatedAt: new Date().toISOString() };
  await saveSourceMaterials(courseId, knowledgeId, manifest);
  return manifest;
}

export function transcriptRelativePath(kind: "raw" | "semantic", title: string) {
  const suffix = kind === "raw" ? "RawTranscript.json" : "SemanticTranscript.md";
  return `source_materials/transcripts/${kind}/${cleanTranscriptTitle(title)}_${suffix}`;
}

export async function writeTranscriptFile(courseId: string, knowledgeId: string, relativePath: string, content: string | Buffer) {
  const root = knowledgeDir(courseId, knowledgeId);
  const file = transcriptFilePath(courseId, knowledgeId, relativePath);
  await ensureDir(path.dirname(file));
  if (Buffer.isBuffer(content)) await writeBinary(file, content);
  else await writeText(file, content);
  return path.relative(root, file).split(path.sep).join("/");
}

export function transcriptFilePath(courseId: string, knowledgeId: string, relativePath: string) {
  if (!relativePath.startsWith("source_materials/transcripts/")) throw new Error("Invalid transcript path");
  const ext = path.extname(relativePath).toLowerCase();
  if (!transcriptAllowed.includes(ext)) throw new Error("Invalid transcript file");
  const root = knowledgeDir(courseId, knowledgeId);
  return ensureInside(root, path.join(root, relativePath));
}

async function deleteTranscriptFile(courseId: string, knowledgeId: string, relativePath: string) {
  try {
    await removeDir(transcriptFilePath(courseId, knowledgeId, relativePath));
  } catch {
    // Keep delete idempotent when old manifests point at files that no longer exist.
  }
}

export async function getSourceMaterialCounts(courseId: string, knowledgeId: string) {
  const root = sourceRoot(courseId, knowledgeId);
  const countLegal = async (dir: string) => {
    try {
      const names = await listDir(dir);
      return names.filter((name) => allowed.includes(path.extname(name).toLowerCase())).length;
    } catch {
      return 0;
    }
  };
  const videos = await readJson<VideoLink[]>(path.join(root, "videos.json"), (await getSourceMaterials(courseId, knowledgeId)).videos || []);
  return {
    videoCount: videos.length,
    documentCount: await countLegal(path.join(root, "files")),
    qaNotesCount: await countLegal(path.join(root, "qa_notes"))
  };
}

export function normaliseContext(courseId?: string | null, knowledgeId?: string | null) {
  return { courseId: safeSegment(courseId || "philosophy"), knowledgeId: safeSegment(knowledgeId || "epicureanism") };
}
