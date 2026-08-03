import path from "path";
import { atomicWriteJson, ensureDir, readJson, readText, writeText } from "./fileStore";
import { knowledgeDir } from "./knowledgeStore";
import { readDefaultDraftRequirements } from "./promptStore";
import { DEFAULT_MODEL_ID, displayModelLabel, findConfiguredModel } from "./modelStore";

export function draftDir(courseId: string, knowledgeId: string) {
  return path.join(knowledgeDir(courseId, knowledgeId), "llm_draft");
}

export function requirementsPath(courseId: string, knowledgeId: string) {
  return path.join(draftDir(courseId, knowledgeId), "requirements.txt");
}

export function generatedOutputPath(courseId: string, knowledgeId: string) {
  return path.join(draftDir(courseId, knowledgeId), "generated_output.md");
}

export function incrementalOutputPath(courseId: string, knowledgeId: string) {
  return path.join(draftDir(courseId, knowledgeId), "incremental_output.md");
}

export function importSourceOutputPath(courseId: string, knowledgeId: string) {
  return path.join(draftDir(courseId, knowledgeId), "import_source_output.md");
}

export function importSourceSelectionPath(courseId: string, knowledgeId: string) {
  return path.join(draftDir(courseId, knowledgeId), "import_source_selection.json");
}

export function modelPath(courseId: string, knowledgeId: string) {
  return path.join(draftDir(courseId, knowledgeId), "model.json");
}

export async function readRequirements(courseId: string, knowledgeId: string) {
  try {
    return { requirements: await readText(requirementsPath(courseId, knowledgeId)), source: "saved" as const, error: null };
  } catch {
    try {
      return { requirements: await readDefaultDraftRequirements(), source: "default" as const, error: null };
    } catch (error) {
      return { requirements: "", source: "missing" as const, error: error instanceof Error ? error.message : "Missing prompt file" };
    }
  }
}

export async function saveRequirements(courseId: string, knowledgeId: string, requirements: string) {
  await ensureDir(draftDir(courseId, knowledgeId));
  await writeText(requirementsPath(courseId, knowledgeId), requirements);
}

export async function readGeneratedOutput(courseId: string, knowledgeId: string) {
  try {
    return await readText(generatedOutputPath(courseId, knowledgeId));
  } catch {
    return "";
  }
}

export async function saveGeneratedOutput(courseId: string, knowledgeId: string, output: string) {
  await ensureDir(draftDir(courseId, knowledgeId));
  await writeText(generatedOutputPath(courseId, knowledgeId), output);
}

export async function readIncrementalOutput(courseId: string, knowledgeId: string) {
  try {
    return await readText(incrementalOutputPath(courseId, knowledgeId));
  } catch {
    return "";
  }
}

export async function saveIncrementalOutput(courseId: string, knowledgeId: string, output: string) {
  await ensureDir(draftDir(courseId, knowledgeId));
  await writeText(incrementalOutputPath(courseId, knowledgeId), output);
}

export async function readImportSourceOutput(courseId: string, knowledgeId: string) {
  try {
    return await readText(importSourceOutputPath(courseId, knowledgeId));
  } catch {
    return "";
  }
}

export async function saveImportSourceOutput(courseId: string, knowledgeId: string, output: string) {
  await ensureDir(draftDir(courseId, knowledgeId));
  await writeText(importSourceOutputPath(courseId, knowledgeId), output);
}

export async function saveImportSourceSelection(courseId: string, knowledgeId: string, selectionData: unknown) {
  await ensureDir(draftDir(courseId, knowledgeId));
  await atomicWriteJson(importSourceSelectionPath(courseId, knowledgeId), selectionData);
}

export async function saveOpenRouterDebug(courseId: string, knowledgeId: string, requestData: unknown, responseData: unknown) {
  await atomicWriteJson(path.join(draftDir(courseId, knowledgeId), "openrouter_request.json"), requestData);
  await atomicWriteJson(path.join(draftDir(courseId, knowledgeId), "openrouter_response.json"), responseData);
}

export async function readOpenRouterDebug(courseId: string, knowledgeId: string) {
  return readJson<Record<string, unknown>>(path.join(draftDir(courseId, knowledgeId), "openrouter_response.json"), {});
}

export async function saveIncrementalDebug(courseId: string, knowledgeId: string, requestData: unknown, responseData: unknown, selectionData: unknown) {
  await atomicWriteJson(path.join(draftDir(courseId, knowledgeId), "incremental_request.json"), requestData);
  await atomicWriteJson(path.join(draftDir(courseId, knowledgeId), "incremental_response.json"), responseData);
  await atomicWriteJson(path.join(draftDir(courseId, knowledgeId), "incremental_selection.json"), selectionData);
}

export async function readDraftMeta(courseId: string, knowledgeId: string) {
  return readJson(path.join(draftDir(courseId, knowledgeId), "draft.json"), {});
}

export async function readSelectedModel(courseId: string, knowledgeId: string) {
  const saved = await readJson<{ model?: string; label?: string; updatedAt?: string } | null>(modelPath(courseId, knowledgeId), null);
  const configured = findConfiguredModel(saved?.model || DEFAULT_MODEL_ID) || findConfiguredModel(DEFAULT_MODEL_ID);
  return {
    model: configured?.id || DEFAULT_MODEL_ID,
    label: configured ? displayModelLabel(configured) : "OpenRouter Auto",
    updatedAt: saved?.updatedAt || null
  };
}

export async function saveSelectedModel(courseId: string, knowledgeId: string, modelId: string) {
  const configured = findConfiguredModel(modelId);
  if (!configured) throw new Error("Selected model is not configured.");
  const payload = {
    model: configured.id,
    label: displayModelLabel(configured),
    updatedAt: new Date().toISOString()
  };
  await ensureDir(draftDir(courseId, knowledgeId));
  await atomicWriteJson(modelPath(courseId, knowledgeId), payload);
  return payload;
}
