import { NextResponse } from "next/server";
import { getSourceMaterials, normaliseContext } from "@/services/sourceMaterialStore";
import { readDraftMeta, readGeneratedOutput, readImportSourceOutput, readIncrementalOutput, readOpenRouterDebug, readRequirements, readSelectedModel } from "@/services/draftStore";
import { resolveModelMaxCompletionTokens } from "@/services/openRouterModelLimits";
import { hasExistingWikiContent } from "@/services/wikiStore";
import { listSelectableSources } from "@/services/selectableSourceStore";

function finishReasonFromDebug(debug: Record<string, unknown>) {
  const summaryReason = typeof debug.finish_reason === "string" ? debug.finish_reason : "";
  if (summaryReason) return summaryReason;
  const choices = (debug as { choices?: { finish_reason?: string }[] }).choices;
  return choices?.[0]?.finish_reason || "";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const ctx = normaliseContext(url.searchParams.get("courseId"), url.searchParams.get("knowledgeId"));
  const requirements = await readRequirements(ctx.courseId, ctx.knowledgeId);
  const output = await readGeneratedOutput(ctx.courseId, ctx.knowledgeId);
  const incrementalOutput = await readIncrementalOutput(ctx.courseId, ctx.knowledgeId);
  const importSourceOutput = await readImportSourceOutput(ctx.courseId, ctx.knowledgeId);
  const meta = await readDraftMeta(ctx.courseId, ctx.knowledgeId);
  const openRouterDebug = await readOpenRouterDebug(ctx.courseId, ctx.knowledgeId);
  const finishReason = (meta as { finishReason?: string }).finishReason || finishReasonFromDebug(openRouterDebug);
  const draftWarning = (meta as { draftWarning?: string }).draftWarning || (finishReason === "length"
    ? "The model stopped because it reached the output token limit. Try a model with a larger output limit or use chunked extraction."
    : "");
  const selectedModel = await readSelectedModel(ctx.courseId, ctx.knowledgeId);
  const selectedModelLimit = resolveModelMaxCompletionTokens({ model: selectedModel.model, generationType: "full" });
  const sources = await getSourceMaterials(ctx.courseId, ctx.knowledgeId);
  const selectableSources = await listSelectableSources(ctx.courseId, ctx.knowledgeId);
  const hasWiki = await hasExistingWikiContent(ctx.courseId, ctx.knowledgeId);
  return NextResponse.json({
    ...meta,
    ...requirements,
    finishReason,
    draftWarning,
    output,
    incrementalOutput,
    importSourceOutput,
    selectedModel,
    selectedModelLimit,
    selectableSources,
    sourceFiles: sources.files,
    sourceQaNotes: sources.qaNotes,
    hasWiki
  });
}
