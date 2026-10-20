import { clampTutorReply, parseTutorReply, replyMatchesQuestionLanguage, type TutorReplyKind, type TutorToolSpec, type TutorTurn } from "./tutorAnswer";
import type { TutorHealth, TutorFailureReason } from "./tutorHealth";
import type { TutorCallResult, TutorKeyCall, TutorPoolResult, TutorToolCall, TutorUsage } from "./tutorKeyPool";

// The AI Tutor's answer engine (tutor infra 2026-10-20): one claimed question
// in, one answer or one classified failure out. It owns everything between
// the durable queue (service.ts) and a single provider request
// (tutorAnswer.ts): which model to ask, which key (through the key pool),
// the tool-calling loop, retrying what a retry can fix, and checking the
// reply before it may reach the room. All of it stays inside the question's
// answer deadline, which is itself inside the claim lease.

export type TutorEngineCall = (input: { secret: string; model: string; text: string; context: string; roomContext: string; turns: TutorTurn[]; tools?: TutorToolSpec[]; toolChoice?: "none"; timeoutMs?: number }) => Promise<TutorCallResult>;

export type TutorEngineAnswer = {
  status: "answered";
  text: string;
  mode: "course" | "general";
  kind: TutorReplyKind;
  model: string;
  attempts: number;
  toolCalls: number;
  latencyMs: number;
  usage: TutorUsage;
};
export type TutorEngineFailure = { status: "failed"; reason: TutorFailureReason; attempts: number; toolCalls: number; latencyMs: number; usage: TutorUsage };
export type TutorEngineResult = TutorEngineAnswer | TutorEngineFailure;

type Pool = { execute(text: string, call: TutorKeyCall, options?: { deadline?: number; model?: string }): Promise<TutorPoolResult>; ready(): boolean };

// Rounds over the whole model list; between rounds the engine backs off.
export const TUTOR_ENGINE_ROUNDS = 3;
// Model calls one question may make in its tool loop: tool rounds plus the answer.
export const TUTOR_TOOL_STEPS = 3;
// A retry with less time than this left is not started; the first call of a
// question only needs some time left.
const MIN_CALL_MS = 1_500;
// One model call (every key it tries included) gets at most this long, so a
// stalled model leaves time for the next one (QA 2026-10-20); the answer
// deadline still bounds the whole question.
export const TUTOR_CALL_MS = 20_000;
// Tool calls run per model step; a reply asking for more runs the first ones.
const TOOL_CALLS_PER_STEP = 3;
const BACKOFF_MS = [500, 1_500];

// Failures another try (another model, or the same one a moment later) may
// not hit. A rate limit or a spent quota rests the key for that model only,
// so the next model is tried too. The rest end the question at once: a
// missing or refused key is the same on every model and round.
const RETRYABLE = new Set<TutorFailureReason>(["model_gone", "timeout", "upstream_error", "network", "bad_request", "empty", "malformed", "no_model", "rate_limited", "quota", "keys_resting"]);

function poolReason(result: TutorPoolResult, keyCount: number, deadline: number, now: number): TutorFailureReason {
  switch (result.outcome) {
    case "auth_failed": return "auth";
    case "failed": return "network";
    case "ok": return "empty";
    case "tools_unsupported": return "bad_request";
    case "no_key": return keyCount === 0 ? "no_key" : deadline - now <= 0 ? "deadline" : "keys_resting";
    default: return result.outcome;
  }
}

function addUsage(total: TutorUsage, usage: TutorUsage | undefined) {
  if (!usage) return;
  total.promptTokens += usage.promptTokens;
  total.completionTokens += usage.completionTokens;
  if (typeof usage.costUsd === "number") total.costUsd = (total.costUsd ?? 0) + usage.costUsd;
}

export async function answerTutorQuestion(input: {
  question: string;
  context: string;
  roomContext: string;
  keys: Array<{ id: string; secret: string }>;
  models: string[];
  pool: (keys: Array<{ id: string; secret: string }>) => Pool;
  call: TutorEngineCall;
  tools?: { specs: TutorToolSpec[]; run(call: TutorToolCall): Promise<string> };
  health: TutorHealth;
  deadline: number;
  // Re-reads a hot key pool once when every key was refused (a rotation).
  refreshKeys?: () => Promise<Array<{ id: string; secret: string }>>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<TutorEngineResult> {
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const started = now();
  const usage: TutorUsage = { promptTokens: 0, completionTokens: 0 };
  let attempts = 0;
  let toolCalls = 0;
  let keys = input.keys;
  let refreshed = false;
  let lastReason: TutorFailureReason = keys.length === 0 ? "no_key" : "no_model";
  // A usable reply in the wrong language, kept in case no model does better.
  let fallback: TutorEngineAnswer | null = null;
  const fail = (reason: TutorFailureReason): TutorEngineFailure => ({ status: "failed", reason, attempts, toolCalls, latencyMs: now() - started, usage });

  async function askModel(model: string): Promise<TutorEngineResult> {
    const turns: TutorTurn[] = [];
    let tools = input.tools && input.health.modelTakesTools(model) ? input.tools : undefined;
    let retriedWithoutTools = false;
    for (let step = 0; step < TUTOR_TOOL_STEPS; step += 1) {
      if (input.deadline - now() < (attempts === 0 ? 1 : MIN_CALL_MS)) return fail("deadline");
      // Tool definitions go with every call of a tool loop (providers reject
      // tool history without them); the last step forbids another tool call,
      // so the model must answer.
      const offered = tools ? tools.specs : undefined;
      const last = step === TUTOR_TOOL_STEPS - 1;
      const callDeadline = Math.min(input.deadline, now() + TUTOR_CALL_MS);
      const result = await input.pool(keys).execute(input.question, (secret, timeoutMs) => input.call({ secret, model, text: input.question, context: input.context, roomContext: input.roomContext, turns, tools: offered, ...(offered && last ? { toolChoice: "none" as const } : {}), timeoutMs }), { deadline: callDeadline, model });
      attempts += result.outcomes.length;
      addUsage(usage, result.usage);
      if (result.outcome === "tools_unsupported" && tools && !retriedWithoutTools) {
        // The model takes no tools: ask it again without, once, and remember.
        input.health.markModelNoTools(model);
        tools = undefined;
        retriedWithoutTools = true;
        turns.length = 0;
        step -= 1;
        continue;
      }
      if (result.outcome !== "ok") return fail(poolReason(result, keys.length, input.deadline, now()));
      if (result.toolCalls?.length && tools && !last) {
        const calls = result.toolCalls.slice(0, TOOL_CALLS_PER_STEP);
        turns.push({ role: "assistant", content: result.body, toolCalls: calls });
        for (const call of calls) {
          toolCalls += 1;
          const content = await tools.run(call).catch(() => JSON.stringify({ error: "tool failed" }));
          turns.push({ role: "tool", toolCallId: call.id, content });
        }
        continue;
      }
      const body = result.body.trim();
      // A reply that repeats a key is never shown (the provider layer checks
      // the key it used; this checks every key of the pool).
      if (!body || keys.some((key) => body.includes(key.secret))) return fail(body ? "malformed" : "empty");
      const parsed = parseTutorReply(body);
      const text = clampTutorReply(parsed.text);
      if (!text) return fail("empty");
      return {
        status: "answered",
        text,
        // Without course material in context, a "course" tag cannot be
        // honoured: the reply must stay general.
        mode: input.context ? parsed.mode : "general",
        kind: parsed.kind,
        model: result.model || model,
        attempts,
        toolCalls,
        latencyMs: now() - started,
        usage
      };
    }
    return fail("empty");
  }

  if (keys.length === 0) return fail("no_key");
  for (let round = 0; round < TUTOR_ENGINE_ROUNDS; round += 1) {
    const models = input.models.filter((model) => input.health.modelUsable(model));
    if (models.length === 0) {
      // Every model is marked gone: try the list anyway rather than fail
      // without asking (the marks may be stale).
      models.push(...input.models);
    }
    for (let index = 0; index < models.length; index += 1) {
      const model = models[index];
      if (input.deadline - now() < (attempts === 0 ? 1 : MIN_CALL_MS)) return fallback ?? fail(attempts ? lastReason : "deadline");
      const result = await askModel(model);
      if (result.status === "answered") {
        if (replyMatchesQuestionLanguage(input.question, result.text)) return result;
        fallback ??= result;
        lastReason = "malformed";
        continue;
      }
      lastReason = result.reason;
      if (result.reason === "model_gone") {
        input.health.markModelGone(model);
        continue;
      }
      if ((result.reason === "auth" || result.reason === "keys_resting") && input.refreshKeys && !refreshed) {
        // Every key was refused: the pool may have just been rotated (a hot
        // secret), so read it again and, only when it changed, ask this model
        // once more with the new keys.
        refreshed = true;
        const fresh = await input.refreshKeys().catch(() => []);
        if (fresh.length > 0 && JSON.stringify(fresh) !== JSON.stringify(keys)) {
          keys = fresh;
          index -= 1;
          continue;
        }
      }
      if (!RETRYABLE.has(result.reason)) return fallback ?? result;
    }
    if (fallback) return fallback;
    if (round < TUTOR_ENGINE_ROUNDS - 1) {
      const wait = Math.min(BACKOFF_MS[Math.min(round, BACKOFF_MS.length - 1)], input.deadline - now() - MIN_CALL_MS);
      if (wait <= 0) break;
      await sleep(wait);
    }
  }
  return fallback ?? fail(lastReason);
}
