import fs from "fs";
import path from "path";

export type GenerationType = "full" | "incremental" | "chat";

type ModelLimitEntry = {
  label: string;
  id: string;
  contextLength: number | null;
  maxCompletionTokens: number | null;
  maxCompletionTokenSource?: "openrouter" | "fallback" | "auto-fallback";
  supportedParameters: string[];
  pricing?: {
    inputPer1M: number | null;
    outputPer1M: number | null;
    display: string;
  } | null;
  note?: string;
};

type ModelLimitsFile = {
  updatedAt?: string;
  source?: string;
  models?: Record<string, ModelLimitEntry>;
  missingModels?: string[];
};

export const FALLBACK_FULL_GENERATE_MAX_COMPLETION_TOKENS = 12000;
export const FALLBACK_INCREMENTAL_GENERATE_MAX_COMPLETION_TOKENS = 8000;
export const FALLBACK_AUTO_MAX_COMPLETION_TOKENS = 8000;
export const FALLBACK_CHAT_MAX_COMPLETION_TOKENS = 900;
export const PROJECT_HARD_MAX_COMPLETION_TOKENS = 20000;

const MODEL_LIMITS_PATH = path.join(process.cwd(), "config", "openrouter-model-limits.json");
const AUTO_MODEL_ID = "openrouter/auto";

function readModelLimits(): ModelLimitsFile {
  try {
    return JSON.parse(fs.readFileSync(MODEL_LIMITS_PATH, "utf8")) as ModelLimitsFile;
  } catch {
    return {};
  }
}

function fallbackForGenerationType(generationType: GenerationType) {
  if (generationType === "incremental") return FALLBACK_INCREMENTAL_GENERATE_MAX_COMPLETION_TOKENS;
  if (generationType === "chat") return FALLBACK_CHAT_MAX_COMPLETION_TOKENS;
  return FALLBACK_FULL_GENERATE_MAX_COMPLETION_TOKENS;
}

export function resolveModelMaxCompletionTokens({
  model,
  generationType
}: {
  model: string;
  generationType: GenerationType;
}): {
  maxCompletionTokens: number;
    source: "model-limit" | "fallback" | "auto-fallback";
    contextLength?: number | null;
    modelMaxCompletionTokens?: number | null;
    pricing?: ModelLimitEntry["pricing"];
    note?: string;
  } {
  const limits = readModelLimits();
  const modelLimit = limits.models?.[model];

  if (model === AUTO_MODEL_ID) {
    return {
      maxCompletionTokens: FALLBACK_AUTO_MAX_COMPLETION_TOKENS,
      source: "auto-fallback",
      contextLength: null,
      modelMaxCompletionTokens: null,
      pricing: modelLimit?.pricing || { inputPer1M: null, outputPer1M: null, display: "Varies by routed model" },
      note: "Auto route does not expose a stable provider-level max completion token limit. Uses fallback."
    };
  }
  const modelMaxCompletionTokens = modelLimit?.maxCompletionTokens ?? null;
  if (
    typeof modelMaxCompletionTokens === "number" &&
    modelMaxCompletionTokens > 0 &&
    modelLimit?.maxCompletionTokenSource !== "fallback"
  ) {
    return {
      maxCompletionTokens: Math.min(modelMaxCompletionTokens, PROJECT_HARD_MAX_COMPLETION_TOKENS),
      source: "model-limit",
      contextLength: modelLimit?.contextLength ?? null,
      modelMaxCompletionTokens,
      pricing: modelLimit?.pricing ?? null,
      note: modelLimit?.note || ""
    };
  }

  const fallback = fallbackForGenerationType(generationType);
  return {
    maxCompletionTokens: Math.min(fallback, PROJECT_HARD_MAX_COMPLETION_TOKENS),
    source: "fallback",
    contextLength: modelLimit?.contextLength ?? null,
    modelMaxCompletionTokens,
    pricing: modelLimit?.pricing ?? null,
    note: modelLimit
      ? modelLimit.note || "OpenRouter did not return top_provider.max_completion_tokens for this model. Uses fallback."
      : "Model was not found in config/openrouter-model-limits.json. Uses fallback."
  };
}
