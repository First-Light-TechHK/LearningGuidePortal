import { saveImportSourceOutput, saveImportSourceSelection } from "./draftStore";
import { buildImportSourceOutputMarkdown, type ImportedSourceContent } from "./wikiStore";
import { readSelectedSourceContents, type RequestedSelectableSource } from "./selectableSourceStore";

export async function createImportSourceOutput(courseId: string, knowledgeId: string, requestedSources: RequestedSelectableSource[]) {
  if (!requestedSources.length) throw new Error("Select at least one source file to import.");

  const selectedContents = await readSelectedSourceContents(courseId, knowledgeId, requestedSources);
  const importedSources: ImportedSourceContent[] = selectedContents.map(({ source, content }) => ({ originalName: source.label, content }));
  const selection = selectedContents.map(({ source }) => ({
    key: source.key,
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    label: source.label,
    group: source.group,
    originalName: source.originalName,
    relativePath: source.relativePath
  }));

  const result = buildImportSourceOutputMarkdown(importedSources);
  if (!result.markdown.trim()) throw new Error("No readable source text was extracted from the selected files.");

  await saveImportSourceOutput(courseId, knowledgeId, result.markdown);
  await saveImportSourceSelection(courseId, knowledgeId, {
    selectedFiles: selection,
    entryCount: result.entries.length,
    entryTitles: result.entries.map((entry) => entry.title),
    updatedAt: new Date().toISOString()
  });

  return {
    output: result.markdown,
    entryCount: result.entries.length,
    entryTitles: result.entries.map((entry) => entry.title),
    selectedFiles: selection
  };
}
