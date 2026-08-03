import models from "@/config/models.json";

export type ConfiguredModel = {
  label: string;
  id: string;
  note?: string;
};

export const DEFAULT_MODEL_ID = "openrouter/auto";

export function listConfiguredModels(): ConfiguredModel[] {
  const configured = models as ConfiguredModel[];
  const hasAuto = configured.some((model) => model.id === DEFAULT_MODEL_ID);
  return hasAuto
    ? configured
    : [{ label: "Auto", id: DEFAULT_MODEL_ID, note: "Default auto-routing mode." }, ...configured];
}

export function displayModelLabel(model: ConfiguredModel) {
  return model.id === DEFAULT_MODEL_ID ? "OpenRouter Auto" : model.label;
}

export function findConfiguredModel(modelId?: string | null) {
  const id = modelId || DEFAULT_MODEL_ID;
  return listConfiguredModels().find((model) => model.id === id) || null;
}

export function assertConfiguredModel(modelId?: string | null) {
  const model = findConfiguredModel(modelId);
  if (!model) throw new Error("Selected model is not configured.");
  return model;
}
