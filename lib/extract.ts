import path from "path";
import { knowledgeDir } from "@/services/knowledgeStore";
import { getSourceMaterials, StoredFile } from "@/services/sourceMaterialStore";
import { readDraftSysPrompt, readIncrementalDraftSysPrompt } from "@/services/promptStore";
import { saveGeneratedOutput, saveIncrementalDebug, saveIncrementalOutput, saveOpenRouterDebug, saveRequirements } from "@/services/draftStore";
import { DEFAULT_MODEL_ID, displayModelLabel, findConfiguredModel } from "@/services/modelStore";
import { PROJECT_HARD_MAX_COMPLETION_TOKENS, resolveModelMaxCompletionTokens } from "@/services/openRouterModelLimits";
import { readExistingWikiMarkdown } from "@/services/wikiStore";
import { extractSourceFileText } from "@/services/sourceTextExtractor";
import { mergeSelectedSourceContents, readSelectedSourceContents, type RequestedSelectableSource } from "@/services/selectableSourceStore";

function stripCodeFence(value: string) {
  return value.trim().replace(/^```(?:markdown)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function resolveModelLabel(model: string) {
  const configured = findConfiguredModel(model);
  return configured ? displayModelLabel(configured) : model;
}

const FULL_COMPLETENESS_INSTRUCTION = [
  "Produce a comprehensive extraction.",
  "Do not stop after only a few high-level points.",
  "Cover all materially distinct teaching patterns, misconceptions, examples, Socratic prompts, and assessment criteria found in the source.",
  "Prefer completeness over brevity."
].join(" ");

const INCREMENTAL_COMPLETENESS_INSTRUCTION = [
  "For incremental generation, include every meaningful new update or new entry found in the selected source materials.",
  "Do not omit useful updates merely to keep the output short."
].join(" ");

function buildFinalPrompt(draftSysPrompt: string, requirements: string) {
  const trimmedSysPrompt = draftSysPrompt.trim();
  const trimmedRequirements = requirements.trim();
  const requirementsWithCompleteness = [
    trimmedRequirements || "Create the most useful wiki article entries from the provided materials.",
    FULL_COMPLETENESS_INSTRUCTION
  ].join("\n\n");
  if (trimmedSysPrompt.includes("{Draft Requirements}")) {
    return trimmedSysPrompt.replaceAll("{Draft Requirements}", requirementsWithCompleteness);
  }
  return `${trimmedSysPrompt}\n\nDraft Requirements:\n${requirementsWithCompleteness}`;
}

function openRouterDebugSummary(data: {
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  usage?: unknown;
}, model: string, modelLabel: string) {
  const content = data.choices?.[0]?.message?.content || "";
  const finishReason = data.choices?.[0]?.finish_reason || null;
  return {
    model,
    modelLabel,
    finish_reason: finishReason,
    usage: data.usage || null,
    contentLength: content.length,
    contentEnding: content.slice(-500),
    raw: data
  };
}

function incompleteDraftWarning(finishReason?: string | null) {
  return finishReason === "length"
    ? "The model stopped because it reached the output token limit. Try a model with a larger output limit or use chunked extraction."
    : "";
}

async function generateWithOpenRouter(
  finalPrompt: string,
  userContent: string,
  courseId: string,
  knowledgeId: string,
  inputModel?: string,
  generationType: "full" | "incremental" = "full"
) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OpenRouter API key is missing. Please set OPENROUTER_API_KEY.");

  const resolvedModel = inputModel || process.env.OPENROUTER_MODEL || DEFAULT_MODEL_ID;
  const modelLabel = resolveModelLabel(resolvedModel);
  const resolvedLimit = resolveModelMaxCompletionTokens({ model: resolvedModel, generationType });
  const requestBody = {
    model: resolvedModel,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: finalPrompt
      },
      {
        role: "user",
        content: userContent
      }
    ],
    max_completion_tokens: resolvedLimit.maxCompletionTokens
  };
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "http://localhost:3000",
      "X-Title": process.env.OPENROUTER_APP_NAME || "KS Wiki"
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter request failed: ${response.status} ${errorText.slice(0, 300)}`);
  }

  const data = (await response.json()) as { choices?: { message?: { content?: string }; finish_reason?: string }[]; usage?: unknown };
  const output = stripCodeFence(data.choices?.[0]?.message?.content || "");
  if (!output) throw new Error("OpenRouter returned an empty draft");
  const finishReason = data.choices?.[0]?.finish_reason || null;
  return {
    output,
    model: resolvedModel,
    modelLabel,
    finishReason,
    usage: data.usage || null,
    outputLength: output.length,
    draftWarning: incompleteDraftWarning(finishReason),
    requestDebug: {
      model: resolvedModel,
      modelLabel,
      createdAt: new Date().toISOString(),
      temperature: requestBody.temperature,
      messages: requestBody.messages,
      max_completion_tokens: requestBody.max_completion_tokens,
      generationType,
      maxCompletionTokens: resolvedLimit.maxCompletionTokens,
      maxCompletionTokenSource: resolvedLimit.source,
      modelContextLength: resolvedLimit.contextLength ?? null,
      modelMaxCompletionTokens: resolvedLimit.modelMaxCompletionTokens ?? null,
      modelLimitNote: resolvedLimit.note || "",
      projectHardMaxCompletionTokens: PROJECT_HARD_MAX_COMPLETION_TOKENS
    },
    responseDebug: {
      ...openRouterDebugSummary(data, resolvedModel, modelLabel),
      createdAt: new Date().toISOString()
    }
  };
}

async function extractChunks(courseId: string, knowledgeId: string, files: StoredFile[]) {
  const chunks = [];
  for (const file of files) {
    const text = await extractSourceFileText(courseId, knowledgeId, file.relativePath, file.originalName).catch(() => "");
    if (text.trim()) chunks.push(`Source: ${file.originalName}\n${text.trim()}`);
  }
  return chunks;
}

function buildIncrementalUserContent(requirements: string, selectedSourceContent: string, existingWikiContent: string) {
  return [
    `Draft Requirements:\n${[
      requirements.trim() || "Create the most useful wiki article entries from the provided materials.",
      INCREMENTAL_COMPLETENESS_INSTRUCTION
    ].join("\n\n")}`,
    `Selected incremental source materials:\n${selectedSourceContent || "No readable source text was extracted from the selected files."}`,
    `Existing Knowledge Wiki entries:\n${existingWikiContent.trim() || "No existing Wiki found. Treat useful extracted ideas as New Entries."}`
  ].join("\n\n");
}

export function normaliseIncrementalDraftHeadings(markdown: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const output: string[] = [];
  let skippedTitle = false;

  for (const line of lines) {
    if (!skippedTitle && /^#\s+Incremental Wiki Update Proposal\s*$/i.test(line.trim())) {
      skippedTitle = true;
      continue;
    }
    skippedTitle = true;
    if (/^####\s+/.test(line)) {
      output.push(line.replace(/^####\s+/, "### "));
    } else if (/^###\s+/.test(line)) {
      output.push(line.replace(/^###\s+/, "## "));
    } else if (/^##\s+/.test(line)) {
      output.push(line.replace(/^##\s+/, "# "));
    } else {
      output.push(line);
    }
  }

  return output.join("\n").replace(/^\s+/, "").trim();
}

export async function generateDraft(requirements: string, courseId = "philosophy", knowledgeId = "epicureanism", model?: string) {
  await saveRequirements(courseId, knowledgeId, requirements);
  const draftSysPrompt = await readDraftSysPrompt();
  const finalPrompt = buildFinalPrompt(draftSysPrompt, requirements);
  const sources = await getSourceMaterials(courseId, knowledgeId);
  const files = [...sources.files, ...(sources.qaNotes ? [sources.qaNotes] : [])];
  const chunks = await extractChunks(courseId, knowledgeId, files);
  const combined = chunks.join("\n\n").slice(0, 30000);
  const result = await generateWithOpenRouter(
    finalPrompt,
    `Source materials:\n${combined || "No readable source text was extracted."}`,
    courseId,
    knowledgeId,
    model,
    "full"
  );
  const output = normaliseIncrementalDraftHeadings(result.output);
  await saveGeneratedOutput(courseId, knowledgeId, output);
  await saveOpenRouterDebug(courseId, knowledgeId, result.requestDebug, result.responseDebug);

  await import("@/services/fileStore").then(({ atomicWriteJson }) =>
    atomicWriteJson(path.join(knowledgeDir(courseId, knowledgeId), "llm_draft", "draft.json"), {
      requirements,
      output,
      provider: "openrouter",
      model: result.model,
      modelLabel: result.modelLabel,
      finishReason: result.finishReason,
      usage: result.usage,
      outputLength: result.outputLength,
      draftWarning: result.draftWarning,
      error: null,
      sourceCount: files.length,
      dataRoot: knowledgeDir(courseId, knowledgeId),
      finalPromptPreview: finalPrompt.slice(0, 1200),
      generatedAt: new Date().toISOString()
    })
  );

  return {
    output,
    provider: "openrouter",
    model: result.model,
    modelLabel: result.modelLabel,
    finishReason: result.finishReason,
    outputLength: result.outputLength,
    draftWarning: result.draftWarning,
    error: null
  };
}

export async function generateIncrementalDraft(requirements: string, courseId = "philosophy", knowledgeId = "epicureanism", selectedFiles: RequestedSelectableSource[], model?: string) {
  if (!selectedFiles.length) throw new Error("Select at least one source file for incremental generation.");

  await saveRequirements(courseId, knowledgeId, requirements);
  const selectedContents = await readSelectedSourceContents(courseId, knowledgeId, selectedFiles);
  const selectedSourceContent = mergeSelectedSourceContents(selectedContents).slice(0, 30000);
  const existingWikiContent = await readExistingWikiMarkdown(courseId, knowledgeId);
  const incrementalSysPrompt = await readIncrementalDraftSysPrompt();
  const userContent = buildIncrementalUserContent(requirements, selectedSourceContent, existingWikiContent).slice(0, 42000);
  const result = await generateWithOpenRouter(
    [incrementalSysPrompt.trim(), INCREMENTAL_COMPLETENESS_INSTRUCTION].filter(Boolean).join("\n\n"),
    userContent,
    courseId,
    knowledgeId,
    model,
    "incremental"
  );
  const output = result.output;
  await saveIncrementalOutput(courseId, knowledgeId, output);

  const selectedFilesSummary = selectedContents.map(({ source }) => ({
    key: source.key,
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    label: source.label,
    group: source.group,
    originalName: source.originalName,
    relativePath: source.relativePath
  }));
  await saveIncrementalDebug(
    courseId,
    knowledgeId,
    {
      ...result.requestDebug,
      selectedFiles: selectedFilesSummary,
      selectedSourceCount: selectedFilesSummary.length,
      existingWikiFound: Boolean(existingWikiContent.trim()),
      requirementsPreview: requirements.slice(0, 1200)
    },
    result.responseDebug,
    {
      selectedFiles: selectedFilesSummary,
      selectedAt: new Date().toISOString()
    }
  );

  return {
    output,
    provider: "openrouter",
    model: result.model,
    modelLabel: result.modelLabel,
    finishReason: result.finishReason,
    usage: result.usage,
    outputLength: result.outputLength,
    draftWarning: result.draftWarning,
    error: null,
    selectedFiles: selectedFilesSummary,
    existingWikiFound: Boolean(existingWikiContent.trim())
  };
}
