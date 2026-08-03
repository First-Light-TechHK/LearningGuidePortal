import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const FALLBACK_FULL_GENERATE_MAX_COMPLETION_TOKENS = 12000;
const FALLBACK_AUTO_MAX_COMPLETION_TOKENS = 8000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const modelsPath = path.join(projectRoot, "config", "models.json");
const outputPath = path.join(projectRoot, "config", "openrouter-model-limits.json");

function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

async function main() {
  const configuredModels = JSON.parse(await readFile(modelsPath, "utf8"));
  if (!Array.isArray(configuredModels)) throw new Error("config/models.json must contain an array.");

  const response = await fetch(OPENROUTER_MODELS_URL, {
    headers: {
      Accept: "application/json"
    }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter models request failed: ${response.status} ${text.slice(0, 300)}`);
  }

  const data = await response.json();
  const openRouterModels = Array.isArray(data?.data) ? data.data : [];
  const byId = new Map(openRouterModels.map((model) => [model.id, model]));
  const missingModels = [];
  const models = {};

  for (const configured of configuredModels) {
    const id = configured.id;
    const label = configured.label || id;

    if (id === "openrouter/auto") {
      models[id] = {
        label,
        id,
        contextLength: null,
        maxCompletionTokens: FALLBACK_AUTO_MAX_COMPLETION_TOKENS,
        maxCompletionTokenSource: "auto-fallback",
        supportedParameters: [],
        pricing: null,
        note: "Auto route does not expose a stable provider-level max completion token limit. Uses fallback."
      };
      continue;
    }

    const match = byId.get(id);
    if (!match) {
      missingModels.push(id);
      models[id] = {
        label,
        id,
        contextLength: null,
        maxCompletionTokens: FALLBACK_FULL_GENERATE_MAX_COMPLETION_TOKENS,
        maxCompletionTokenSource: "fallback",
        supportedParameters: [],
        pricing: null,
        note: "Model was not found in OpenRouter /api/v1/models. Uses fallback."
      };
      continue;
    }

    const openRouterMax = asNumber(match.top_provider?.max_completion_tokens);
    const usesFallback = openRouterMax === null;
    models[id] = {
      label,
      id,
      openRouterName: match.name || null,
      contextLength: asNumber(match.context_length),
      maxCompletionTokens: openRouterMax ?? FALLBACK_FULL_GENERATE_MAX_COMPLETION_TOKENS,
      maxCompletionTokenSource: usesFallback ? "fallback" : "openrouter",
      supportedParameters: asStringArray(match.supported_parameters),
      pricing: match.pricing ?? null,
      note: usesFallback
        ? "OpenRouter did not return top_provider.max_completion_tokens for this model. Uses fallback."
        : ""
    };
  }

  const output = {
    updatedAt: new Date().toISOString(),
    source: OPENROUTER_MODELS_URL,
    models,
    missingModels
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.log(`Wrote ${outputPath}`);
  for (const [id, limit] of Object.entries(models)) {
    console.log(`${id}: maxCompletionTokens=${limit.maxCompletionTokens} source=${limit.maxCompletionTokenSource} contextLength=${limit.contextLength ?? "unknown"}`);
  }
  if (missingModels.length) console.log(`Missing models: ${missingModels.join(", ")}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
