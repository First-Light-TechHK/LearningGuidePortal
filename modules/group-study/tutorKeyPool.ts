// What one provider call came back with. The first five are key-level
// verdicts the pool acts on; the rest describe the model or the reply, and
// the pool hands them straight back to the caller (tutorEngine.ts), which
// decides whether to switch model, retry or give up (tutor infra 2026-10-20).
export type TutorKeyOutcome =
  | "ok"
  // Network-class failure: connection reset, DNS, an unreadable response.
  | "failed"
  | "auth_failed"
  | "rate_limited"
  | "quota"
  // The provider answered past the call's own time limit.
  | "timeout"
  // The provider failed on its side (HTTP 5xx).
  | "upstream_error"
  // The model id is gone (OpenRouter 404 "No endpoints found" for a retired
  // model): every key would get the same answer.
  | "model_gone"
  // The model rejected the tool definitions: retry the model without tools.
  | "tools_unsupported"
  // Any other request the provider refused (HTTP 400).
  | "bad_request"
  // A 200 with no answer text and no tool call.
  | "empty"
  // A 200 whose body could not be parsed, or that echoed a key.
  | "malformed";

export type TutorToolCall = { id: string; name: string; arguments: string };
export type TutorUsage = { promptTokens: number; completionTokens: number; costUsd?: number };
export type TutorCallResult = { outcome: TutorKeyOutcome; latencyMs: number; body?: string; toolCalls?: TutorToolCall[]; usage?: TutorUsage; model?: string };

// `timeoutMs`, when given, is how long this one call may take: what is left
// of the caller's deadline.
export type TutorKeyCall = (secret: string, timeoutMs?: number) => Promise<TutorCallResult>;

// Outcomes that say nothing about the key: another key would get the same
// answer, so the pool stops and hands the outcome back.
const NOT_THE_KEY = new Set<TutorKeyOutcome>(["model_gone", "tools_unsupported", "bad_request", "empty", "malformed"]);

// Bug hunt 2026-10-14 (M4): a rate limit or a spent quota is a transient
// provider state, not a verdict on the key. The pool used to mark such a key
// permanently unhealthy for the life of the process, so a single 429 could
// leave the environment without an AI Tutor until a restart. Limited keys now
// rest for a cooldown and are retried; a quota is expected to relax on a
// longer horizon than a rate-limit window. An authenticated rejection stays
// permanent: the key is wrong, not busy.
// QA 2026-10-20: a rate limit or a "more credits" refusal on OpenRouter is
// often about one model (its upstream limit, its price), so it rests the key
// for that model only and the next model of the list may still use it. A
// refused key (401/403) rests for every model, for a bounded time: a hot key
// pool replaces a rotated key, and a 403 is not always the key's fault.
export const TUTOR_KEY_COOLDOWN_MS: Record<"rate_limited" | "quota" | "auth_failed", number> = {
  rate_limited: 60_000,
  quota: 300_000,
  auth_failed: 10 * 60_000
};

type KeyState = {
  id: string;
  secret: string;
  requests: number;
  errors: number;
  latencyMs: number;
  // Epoch milliseconds until which the key must not be attempted for any
  // model (auth_failed). 0 means available.
  disabledUntil: number;
  // The same, per model (rate_limited, quota).
  modelDisabledUntil: Map<string, number>;
};

export type TutorPoolResult = {
  keyId: string;
  body: string;
  log: string;
  // The last outcome seen, and every outcome in order (one per key tried).
  outcome: TutorKeyOutcome | "no_key";
  outcomes: TutorKeyOutcome[];
  toolCalls?: TutorToolCall[];
  usage?: TutorUsage;
  model?: string;
  latencyMs: number;
};

export function createTutorKeyPool(input: { keys: Array<{ id: string; secret: string }>; call: TutorKeyCall; now?: () => number }) {
  const now = input.now ?? Date.now;
  const states: KeyState[] = input.keys.map((key) => ({
    id: key.id,
    secret: key.secret,
    requests: 0,
    errors: 0,
    latencyMs: 0,
    disabledUntil: 0,
    modelDisabledUntil: new Map<string, number>()
  }));

  return {
    // `deadline` (epoch milliseconds) bounds the whole answer, every key
    // included: no key is tried after it, and each call gets only the time
    // left (QA r3 server 5), so one question never outlives its claim lease.
    // `model` scopes the per-model rests; without it they apply to the key.
    async execute(text: string, call: TutorKeyCall = input.call, options: { deadline?: number; model?: string } = {}): Promise<TutorPoolResult> {
      void text;
      const outcomes: TutorKeyOutcome[] = [];
      let latencyMs = 0;
      for (const state of states) {
        if (state.disabledUntil > now()) continue;
        if ((state.modelDisabledUntil.get(options.model ?? "") ?? 0) > now()) continue;
        const left = options.deadline === undefined ? undefined : options.deadline - now();
        if (left !== undefined && left <= 0) break;
        state.requests += 1;
        const result = await call(state.secret, left);
        state.latencyMs += result.latencyMs;
        latencyMs += result.latencyMs;
        outcomes.push(result.outcome);
        if (result.outcome === "ok") {
          return { keyId: state.id, body: result.body ?? "", log: `key ${state.id} ok`, outcome: "ok", outcomes, latencyMs, ...(result.toolCalls?.length ? { toolCalls: result.toolCalls } : {}), ...(result.usage ? { usage: result.usage } : {}), ...(result.model ? { model: result.model } : {}) };
        }
        state.errors += 1;
        if (result.outcome === "auth_failed") state.disabledUntil = now() + TUTOR_KEY_COOLDOWN_MS.auth_failed;
        else if (result.outcome === "rate_limited" || result.outcome === "quota") state.modelDisabledUntil.set(options.model ?? "", now() + TUTOR_KEY_COOLDOWN_MS[result.outcome]);
        // "failed", "timeout" and "upstream_error" leave the key available:
        // the next key gets this question, the same key the next one.
        if (NOT_THE_KEY.has(result.outcome)) return { keyId: "", body: "", log: `key ${state.id} ${result.outcome}`, outcome: result.outcome, outcomes, latencyMs, ...(result.usage ? { usage: result.usage } : {}) };
      }
      // With mixed outcomes, a passing one (a rest, a timeout) describes the
      // question better than one refused key among them: only an all-refused
      // pool reports auth_failed.
      const passing = outcomes.filter((outcome) => outcome !== "auth_failed");
      return { keyId: "", body: "", log: "no healthy key", outcome: passing.at(-1) ?? outcomes.at(-1) ?? "no_key", outcomes, latencyMs };
    },
    // Keys not resting: when none is, the pool can only answer "no key".
    ready() {
      return states.some((state) => state.disabledUntil <= now());
    },
    stats() {
      return Object.fromEntries(states.map((state) => [state.id, { requests: state.requests, errors: state.errors, latencyMs: state.latencyMs }]));
    }
  };
}
