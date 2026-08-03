import path from "path";
import { getSourceMaterials } from "./sourceMaterialStore";
import { extractSourceFileText } from "./sourceTextExtractor";

export type SelectableSourceType = "document" | "qa_note" | "youtube_transcript";
export type SelectableSourceGroup = "Documents" | "Q&A Notes" | "YouTube Transcripts";

export type SelectableSource = {
  key: string;
  sourceType: SelectableSourceType;
  sourceId: string;
  label: string;
  group: SelectableSourceGroup;
  relativePath: string;
  originalName: string;
};

export type RequestedSelectableSource = {
  sourceType?: SelectableSourceType | "file" | "source_material" | "qa_notes";
  sourceId?: string;
  fileId?: string;
  key?: string;
};

export type SelectedSourceContent = {
  source: SelectableSource;
  content: string;
};

function sourceKey(sourceType: SelectableSourceType, sourceId: string) {
  return `${sourceType}:${sourceId}`;
}

function normaliseRequestedSourceType(sourceType: RequestedSelectableSource["sourceType"]): SelectableSourceType | null {
  if (sourceType === "document" || sourceType === "file" || sourceType === "source_material") return "document";
  if (sourceType === "qa_note" || sourceType === "qa_notes") return "qa_note";
  if (sourceType === "youtube_transcript") return "youtube_transcript";
  return null;
}

function semanticTranscriptName(relativePath: string) {
  return path.basename(relativePath).replace(/_/g, " ");
}

export async function listSelectableSources(courseId: string, knowledgeId: string): Promise<SelectableSource[]> {
  const manifest = await getSourceMaterials(courseId, knowledgeId);
  const documents: SelectableSource[] = manifest.files.map((file) => ({
    key: sourceKey("document", file.id),
    sourceType: "document",
    sourceId: file.id,
    label: file.originalName,
    group: "Documents",
    relativePath: file.relativePath,
    originalName: file.originalName
  }));

  const qaNotes: SelectableSource[] = manifest.qaNotes ? [{
    key: sourceKey("qa_note", manifest.qaNotes.id),
    sourceType: "qa_note",
    sourceId: manifest.qaNotes.id,
    label: manifest.qaNotes.originalName,
    group: "Q&A Notes",
    relativePath: manifest.qaNotes.relativePath,
    originalName: manifest.qaNotes.originalName
  }] : [];

  const youtubeTranscripts: SelectableSource[] = manifest.videos
    .filter((video) => Boolean(video.semanticTranscriptPath))
    .map((video) => {
      const fileName = semanticTranscriptName(video.semanticTranscriptPath || "Semantic Transcript.md");
      const label = video.title ? `${video.title} - Semantic Transcript.md` : fileName;
      return {
        key: sourceKey("youtube_transcript", video.id),
        sourceType: "youtube_transcript" as const,
        sourceId: video.id,
        label,
        group: "YouTube Transcripts" as const,
        relativePath: video.semanticTranscriptPath || "",
        originalName: fileName.endsWith(".md") ? fileName : "Semantic Transcript.md"
      };
    })
    .filter((source) => source.relativePath);

  return [...documents, ...qaNotes, ...youtubeTranscripts];
}

export async function resolveSelectedSources(courseId: string, knowledgeId: string, requestedSources: RequestedSelectableSource[]) {
  const selectableSources = await listSelectableSources(courseId, knowledgeId);
  const byKey = new Map(selectableSources.map((source) => [source.key, source]));
  const byTypeAndId = new Map(selectableSources.map((source) => [`${source.sourceType}:${source.sourceId}`, source]));
  const selected: SelectableSource[] = [];
  const seen = new Set<string>();

  for (const requested of requestedSources) {
    const sourceType = normaliseRequestedSourceType(requested.sourceType);
    const sourceId = (requested.sourceId || requested.fileId || "").trim();
    const key = requested.key?.trim() || (sourceType && sourceId ? sourceKey(sourceType, sourceId) : "");
    const source = (key ? byKey.get(key) : undefined) || (sourceType && sourceId ? byTypeAndId.get(sourceKey(sourceType, sourceId)) : undefined);
    if (!source) throw new Error("Selected source file was not found.");
    if (!seen.has(source.key)) {
      selected.push(source);
      seen.add(source.key);
    }
  }

  return selected;
}

export async function readSelectedSourceContents(courseId: string, knowledgeId: string, requestedSources: RequestedSelectableSource[]) {
  if (!requestedSources.length) throw new Error("Select at least one source file.");
  const sources = await resolveSelectedSources(courseId, knowledgeId, requestedSources);
  const contents: SelectedSourceContent[] = [];
  for (const source of sources) {
    const content = await extractSourceFileText(courseId, knowledgeId, source.relativePath, source.originalName).catch(() => "");
    if (content.trim()) contents.push({ source, content });
  }
  return contents;
}

export function mergeSelectedSourceContents(selectedContents: SelectedSourceContent[]) {
  return selectedContents
    .map(({ source, content }) => `Source: ${source.label}\n${content.trim()}`)
    .filter((chunk) => chunk.trim())
    .join("\n\n");
}
