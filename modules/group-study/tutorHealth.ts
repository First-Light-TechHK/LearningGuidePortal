// The AI Tutor's own health, per process (tutor infra 2026-10-20): what the
// last hour of answers looked like, which models the provider has retired or
// that refuse tools, how much today cost, and from that whether the room
// should offer the Tutor at all. Nothing here holds an id, a name, a question
// or a key: it is counts, classes and model names only.
//
// Per process on purpose: App Runner runs a few instances, each sees its own
// traffic, and each decides its own availability from it. The daily budget is
// therefore per instance too; the runtime sizes it with that in mind.

export type TutorFailureReason =
  | "no_key"
  | "auth"
  | "quota"
  | "rate_limited"
  | "keys_resting"
  | "model_gone"
  | "no_model"
  | "timeout"
  | "upstream_error"
  | "network"
  | "bad_request"
  | "empty"
  | "malformed"
  | "deadline"
  | "budget";

// What the room is told about a failed answer: a coarse class, never the
// provider's internals (QA 2026-10-20). "busy" passes on its own, "setup"
// needs an operator, "refused" was this question, "provider" is the rest.
export type TutorPublicReason = "busy" | "setup" | "refused" | "provider";
export function publicTutorReason(reason: TutorFailureReason): TutorPublicReason {
  if (reason === "rate_limited" || reason === "quota" || reason === "keys_resting" || reason === "budget") return "busy";
  if (reason === "no_key" || reason === "auth") return "setup";
  if (reason === "bad_request") return "refused";
  return "provider";
}

export type TutorUnavailableReason = "no_key" | "provider_down" | "budget";
export type TutorAvailability = { available: true } | { available: false; reason: TutorUnavailableReason };

// Failures in a row, without one answer between them, after which the room
// stops offering the Tutor for a while; after the pause the next question
// probes the provider again (a plain circuit breaker).
export const TUTOR_CIRCUIT_FAILURES = 3;
export const TUTOR_CIRCUIT_PAUSE_MS = 60_000;
// A model the provider called gone is skipped this long, then tried again
// (the id may be back, or the 404 a provider hiccup).
export const TUTOR_MODEL_GONE_MS = 10 * 60_000;
// A model that refused tool definitions is called without tools this long.
export const TUTOR_MODEL_NO_TOOLS_MS = 60 * 60_000;
const WINDOW_MS = 60 * 60_000;

type Sample = { at: number; ok: boolean; reason?: TutorFailureReason; model?: string; latencyMs: number; attempts: number };

function utcDay(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function createTutorHealth(input: { now?: () => number } = {}) {
  const now = input.now ?? Date.now;
  let samples: Sample[] = [];
  let consecutiveFailures = 0;
  let lastFailureAt = 0;
  let lastFailureReason: TutorFailureReason | null = null;
  let spendDay = utcDay(now());
  let spendUsd = 0;
  const goneUntil = new Map<string, number>();
  const noToolsUntil = new Map<string, number>();

  function prune() {
    const cutoff = now() - WINDOW_MS;
    if (samples.length && samples[0].at < cutoff) samples = samples.filter((sample) => sample.at >= cutoff);
    const day = utcDay(now());
    if (day !== spendDay) {
      spendDay = day;
      spendUsd = 0;
    }
  }

  return {
    // One finished question: answered, or failed with its reason.
    record(result: { ok: boolean; reason?: TutorFailureReason; model?: string; latencyMs: number; attempts: number }) {
      prune();
      samples.push({ at: now(), ...result });
      if (result.ok) {
        consecutiveFailures = 0;
        return;
      }
      // A budget refusal is the Tutor declining work, a refused request (a
      // moderated question) is about that question, and a missing key is an
      // operator's to add (the room already says so): none is the provider
      // failing, and none may keep the Tutor paused once it is fixed.
      if (result.reason === "budget" || result.reason === "bad_request" || result.reason === "no_key") return;
      consecutiveFailures += 1;
      lastFailureAt = now();
      lastFailureReason = result.reason ?? null;
    },
    addSpend(costUsd: number | undefined) {
      if (typeof costUsd !== "number" || !Number.isFinite(costUsd) || costUsd <= 0) return;
      prune();
      spendUsd += costUsd;
    },
    spendTodayUsd() {
      prune();
      return spendUsd;
    },
    markModelGone(model: string) {
      goneUntil.set(model, now() + TUTOR_MODEL_GONE_MS);
    },
    markModelNoTools(model: string) {
      noToolsUntil.set(model, now() + TUTOR_MODEL_NO_TOOLS_MS);
    },
    modelUsable(model: string) {
      return (goneUntil.get(model) ?? 0) <= now();
    },
    modelTakesTools(model: string) {
      return (noToolsUntil.get(model) ?? 0) <= now();
    },
    // Whether the room should offer the Tutor right now.
    availability(input: { keysConfigured: boolean; dailyBudgetUsd: number | null }): TutorAvailability {
      prune();
      if (!input.keysConfigured) return { available: false, reason: "no_key" };
      if (input.dailyBudgetUsd !== null && spendUsd >= input.dailyBudgetUsd) return { available: false, reason: "budget" };
      if (consecutiveFailures >= TUTOR_CIRCUIT_FAILURES && now() - lastFailureAt < TUTOR_CIRCUIT_PAUSE_MS) return { available: false, reason: "provider_down" };
      return { available: true };
    },
    // The health page view: the last hour, today's spend, and the model registry.
    snapshot() {
      prune();
      const answered = samples.filter((sample) => sample.ok);
      const failed = samples.filter((sample) => !sample.ok);
      const latencies = answered.map((sample) => sample.latencyMs).sort((left, right) => left - right);
      const p95 = latencies.length ? latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1)] : null;
      const reasons: Record<string, number> = {};
      for (const sample of failed) reasons[sample.reason ?? "unknown"] = (reasons[sample.reason ?? "unknown"] ?? 0) + 1;
      const models: Record<string, number> = {};
      for (const sample of answered) if (sample.model) models[sample.model] = (models[sample.model] ?? 0) + 1;
      const current = now();
      return {
        windowMinutes: WINDOW_MS / 60_000,
        answered: answered.length,
        failed: failed.length,
        successRate: samples.length ? answered.length / samples.length : null,
        p95LatencyMs: p95,
        meanAttempts: samples.length ? samples.reduce((sum, sample) => sum + sample.attempts, 0) / samples.length : null,
        failureReasons: reasons,
        answeredByModel: models,
        consecutiveFailures,
        lastFailureReason,
        spendTodayUsd: Math.round(spendUsd * 1e6) / 1e6,
        goneModels: [...goneUntil].filter(([, until]) => until > current).map(([model]) => model),
        noToolModels: [...noToolsUntil].filter(([, until]) => until > current).map(([model]) => model)
      };
    }
  };
}

export type TutorHealth = ReturnType<typeof createTutorHealth>;
