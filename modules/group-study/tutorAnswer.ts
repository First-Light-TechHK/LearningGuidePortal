import { fetchOpenRouter } from "@/services/openRouterClient";
import { signRoomAdminToken } from "./liveKitToken";
import type { TutorCallResult, TutorToolCall, TutorUsage } from "./tutorKeyPool";

// The reply contract (see tutorPrompt.ts): the first line is a tag — exactly
// COURSE or GENERAL. The tag may be bracketed ([COURSE] … / 【GENERAL】…) or
// bare; a bare tag may only be followed by a colon form or the end of the
// line, because a reply whose first word merely matches the tag — "Course
// material explains …" — is unverified prose and must default to GENERAL.
// That default is the fail-safe: nothing unverified may be presented as
// course content. Bold or italic wrapping around the tag (**COURSE**) is
// tolerated. The tag line is parsed off before the text is published.
// An understanding-check question carries a second word on the tag line,
// QUIZ ("COURSE QUIZ"), so the room can label it and the Tutor knows later
// that it asked the group something (tutor infra 2026-10-20).
const TAG_WORD = "course|general";
const QUIZ_WORD = "\\s+[*_]{0,2}(quiz)[*_]{0,2}";
const BRACKETED_TAG = new RegExp(`^\\s*[\\[【]\\s*[*_]{0,2}(${TAG_WORD})[*_]{0,2}(?:${QUIZ_WORD})?\\s*[\\]】]\\s*[:：\\-–—]?\\s*(.*)$`, "i");
const BARE_TAG = new RegExp(`^\\s*[*_]{0,2}(${TAG_WORD})[*_]{0,2}(?:${QUIZ_WORD})?\\s*(?::\\s*(.*))?$`, "i");

export type TutorReplyKind = "answer" | "quiz";

export function parseTutorReply(raw: string): { mode: "course" | "general"; kind: TutorReplyKind; text: string } {
  const normalized = raw.replace(/\r\n?/g, "\n").trim();
  const newline = normalized.indexOf("\n");
  const firstLine = newline === -1 ? normalized : normalized.slice(0, newline);
  const rest = newline === -1 ? "" : normalized.slice(newline + 1);
  const match = BRACKETED_TAG.exec(firstLine) ?? BARE_TAG.exec(firstLine);
  if (!match) return { mode: "general", kind: "answer", text: normalized };
  const tail = (match[3] ?? "").replace(/^[\s、。，,：:】\]]+/, "").trim();
  return {
    mode: match[1].toLowerCase() === "course" ? "course" : "general",
    kind: match[2] ? "quiz" : "answer",
    text: [tail, rest.trim()].filter(Boolean).join("\n")
  };
}

// Sentence, clause, and line marks a truncated reply may end on.
const REPLY_BOUNDARIES = ["\n", "。", "！", "？", "；", "…", ".", "!", "?", ";", "，", ","];
// Marks the "…" of a cut reply replaces, so it never reads ",…" or "。…".
const TRAILING_MARKS = /[\s。！？；，、：…,.!?;:]+$/u;

// Emphasis markers only count at a word boundary: `x_1`, `snake_case_name`
// and `2*3*4` keep their `_` and `*` (QA 2026-10-19 M22). A word character
// here is an ASCII letter or digit, so CJK text around **重点** still loses
// its markers.
const EDGE_BEFORE = "(^|[^A-Za-z0-9])";
const EDGE_AFTER = "(?![A-Za-z0-9])";
function emphasis(marker: string) {
  const mark = marker.replace(/\*/g, "\\*");
  const body = marker[0] === "*" ? "[^*\\n]" : "[^_\\n]";
  return new RegExp(`${EDGE_BEFORE}${mark}(?=\\S)(${body}*?\\S)${mark}${EDGE_AFTER}`, "g");
}
const EMPHASIS = [emphasis("**"), emphasis("__"), emphasis("*"), emphasis("_")];

// CJK ideographs, kana, Hangul, and CJK / full-width punctuation.
const CJK_CHARACTER = /[\u3000-\u303f\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/gu;

// Share of CJK characters among the visible characters of a text (0 to 1).
export function cjkShare(text: string) {
  const visible = text.replace(/\s+/g, "");
  if (!visible) return 0;
  return (visible.match(CJK_CHARACTER)?.length ?? 0) / visible.length;
}

// The length cap follows the reply's script mix: 480 characters of Latin
// text, 240 of CJK text (a CJK character carries about twice as much), and
// in between in proportion to the share of CJK characters. One Chinese word
// in an English reply no longer halves its room (QA 2026-10-19 M22). The cap
// sits well above the prompt's own budget (360 / 160): current models write
// past a tight budget, and the 2026-10-20 real-model run saw 6 of 20 replies
// cut at the old 240, one mid-sentence. The cap is a runaway guard, not the
// brevity mechanism.
export const TUTOR_REPLY_MAX_LINES = 6;
export function tutorReplyLimit(text: string) {
  return Math.round(480 - 240 * cjkShare(text));
}

// Whether a reply is written in the question's script (tutor infra
// 2026-10-20: one model answered a Chinese question in English). Only a
// clear mismatch counts: a mostly-Chinese question answered in almost no
// Chinese, or a question with no Chinese answered mostly in Chinese.
export function replyMatchesQuestionLanguage(question: string, reply: string) {
  const asked = cjkShare(question);
  const answered = cjkShare(reply);
  if (asked >= 0.3) return answered >= 0.1;
  if (asked === 0) return answered <= 0.5;
  return true;
}

// Reply shape guard (defence in depth behind the prompt's reply_format): drop
// markdown, normalise bullets to "• ", keep at most TUTOR_REPLY_MAX_LINES
// lines (the answer line plus key points), and cap the total length (tutorReplyLimit). An
// over-long reply is cut at the last sentence or line boundary inside the cap
// (its trailing mark becomes "…"); a boundary in the first half is too lossy,
// so the text is cut straight at the cap instead. The result may be empty
// when there is nothing left to say.
export function clampTutorReply(raw: string): string {
  let cleaned = raw
    .replace(/^\s*---+\s*$/gm, "")
    .replace(/^\s*#{1,6}\s*/gm, "")
    .replace(/`([^`\n]*)`/g, "$1")
    .replace(/`/g, "");
  for (const pattern of EMPHASIS) cleaned = cleaned.replace(pattern, "$1$2");
  const lines = cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^(?:[-*]\s+|•\s*)/, "• "))
    .slice(0, TUTOR_REPLY_MAX_LINES);
  const text = lines.join("\n");
  const limit = tutorReplyLimit(text);
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  let boundary = -1;
  for (const mark of REPLY_BOUNDARIES) boundary = Math.max(boundary, cut.lastIndexOf(mark));
  const kept = boundary >= Math.floor(limit / 2) ? text.slice(0, boundary + 1) : cut;
  return `${kept.replace(TRAILING_MARKS, "")}…`;
}

// The Live Session tutor's key pool. Its own STUDY_GROUP_TUTOR_KEYS wins; an
// environment that never set them (DEV and SIT did not, 2026-10-20) uses the
// site's OpenRouter key as a one-key pool instead of answering every question
// "temporarily unavailable". The shared key only ever goes to OpenRouter: a
// custom STUDY_GROUP_TUTOR_URL elsewhere gets no fallback.
export const SHARED_TUTOR_KEY_ID = "openrouter-shared";
export function studyGroupTutorKeys(env: Record<string, string | undefined>) {
  const own = readTutorKeys(env.STUDY_GROUP_TUTOR_KEYS);
  if (own.length > 0) return own;
  const shared = env.OPENROUTER_API_KEY?.trim();
  const url = env.STUDY_GROUP_TUTOR_URL?.trim();
  if (!shared || (url && !isOpenRouterUrl(url))) return [];
  return [{ id: SHARED_TUTOR_KEY_ID, secret: shared }];
}

function isOpenRouterUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && (parsed.hostname === "openrouter.ai" || parsed.hostname.endsWith(".openrouter.ai"));
  } catch {
    return false;
  }
}

export function readTutorKeys(raw: string | undefined) {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const record = item as { id?: unknown; secret?: unknown };
      const id = typeof record.id === "string" ? record.id.trim() : "";
      const secret = typeof record.secret === "string" ? record.secret.trim() : "";
      if (!id || !secret) return [];
      return [{ id, secret }];
    });
  } catch {
    return [];
  }
}

// One message of a tool-calling conversation after the first user turn: the
// model's own tool calls, and each tool's result.
export type TutorTurn =
  | { role: "assistant"; content: string; toolCalls: TutorToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

// A tool the model may call, in OpenAI function form.
export type TutorToolSpec = { name: string; description: string; parameters: Record<string, unknown> };

export function tutorUserMessage(input: { context: string; roomContext?: string; text: string }) {
  return [
    `<course_material>\n${input.context}\n</course_material>`,
    ...(input.roomContext ? [`<room_context>\n${input.roomContext}\n</room_context>`] : []),
    `<participant_text>\n${input.text}\n</participant_text>`,
    "Answer the participant message for the shared room, following the reply format exactly."
  ].join("\n");
}

// Reads a provider error body for the words that tell a retired model or a
// rejected tool definition apart from any other refusal.
const MODEL_GONE = /no endpoints found|not a valid model|model[^\n]{0,40}(?:not found|does not exist|is not available|deprecated)/i;
const TOOLS_REFUSED = /tool|function/i;

function readUsage(json: { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; cost?: unknown } }): TutorUsage | undefined {
  const usage = json.usage;
  if (!usage || typeof usage !== "object") return undefined;
  const promptTokens = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0;
  const completionTokens = typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0;
  return { promptTokens, completionTokens, ...(typeof usage.cost === "number" ? { costUsd: usage.cost } : {}) };
}

function readToolCalls(value: unknown): TutorToolCall[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
    if (typeof record.id !== "string" || typeof record.function?.name !== "string") return [];
    return [{ id: record.id, name: record.function.name, arguments: typeof record.function.arguments === "string" ? record.function.arguments : "{}" }];
  });
}

function timedOut(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as { name?: unknown; code?: unknown; message?: unknown };
  return record.name === "TimeoutError" || record.name === "AbortError" || record.code === "ETIMEDOUT" || (typeof record.message === "string" && /timed out/i.test(record.message));
}

export async function openRouterTutorCall(input: { secret: string; model: string; system: string; context: string; text: string; roomContext?: string; turns?: TutorTurn[]; tools?: TutorToolSpec[]; url?: string; maxTokens?: number; reasoning?: { effort: string }; timeoutMs?: number }): Promise<TutorCallResult> {
  const started = Date.now();
  const maxTokens = input.maxTokens ?? 700;
  // At most 45 s, and never past the caller's answer deadline.
  const timeoutMs = Math.max(1, Math.min(45_000, input.timeoutMs ?? 45_000));
  const messages: Array<Record<string, unknown>> = [
    { role: "system", content: input.system },
    { role: "user", content: tutorUserMessage(input) },
    ...(input.turns ?? []).map((turn) => turn.role === "assistant"
      ? { role: "assistant", content: turn.content || null, tool_calls: turn.toolCalls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } })) }
      : { role: "tool", tool_call_id: turn.toolCallId, content: turn.content })
  ];
  const tools = input.tools?.length ? input.tools.map((tool) => ({ type: "function", function: tool })) : undefined;
  try {
    // Reply budget: 700 completion tokens is a runaway guard, not the brevity
    // mechanism — brevity is the prompt's reply_format plus clampTutorReply.
    // Reasoning models draw their chain of thought from this same completion
    // budget on most providers, so a cap sized to the visible reply lets the
    // model burn everything thinking and return empty content, billed all the
    // same. The CoT policy lives in the shared OpenRouter layer, which injects
    // reasoning { effort: "none", exclude: true } unless the body sets the
    // field, and retries without it when a mandatory-reasoning model rejects
    // it — that fallback (and the direct-URL path, and Gemini) is exactly why
    // this budget must not assume a reasoning-free call. The budget size and an
    // explicit reasoning effort are caller settings (runtime reads
    // STUDY_GROUP_TUTOR_MAX_TOKENS / STUDY_GROUP_TUTOR_REASONING); setting
    // `reasoning` here disables the shared layer's strip-on-400 fallback, so the
    // default leaves the field to the layer.
    const compatibleUrl = input.url?.trim();
    const response = compatibleUrl && !compatibleUrl.includes("openrouter.ai")
      ? await fetch(compatibleUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${input.secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: input.model, temperature: 0.2, max_tokens: maxTokens, stream: false, messages, ...(tools ? { tools } : {}) }),
        signal: AbortSignal.timeout(timeoutMs)
      })
      : await fetchOpenRouter(input.secret, {
      model: input.model,
      temperature: 0.2,
      max_tokens: maxTokens,
      ...(input.reasoning ? { reasoning: input.reasoning } : {}),
      // OpenRouter reports what the call cost, for the daily budget.
      usage: { include: true },
      stream: false,
      messages,
      ...(tools ? { tools } : {})
    }, { timeoutMs, attempts: 1 });
    const latencyMs = Date.now() - started;
    const raw = await response.text();
    if (response.status === 401 || response.status === 403) return { outcome: "auth_failed", latencyMs };
    if (response.status === 429) return { outcome: "rate_limited", latencyMs };
    // Quota wording only decides on a failed response: a 200 completion whose
    // answer text happens to contain "credit" (attribution, course credit) is
    // a valid answer, not a quota signal.
    if (response.status === 402 || (!response.ok && /quota|insufficient_quota|credit/i.test(raw))) return { outcome: "quota", latencyMs };
    if (response.status === 404 || ((response.status === 400 || response.status === 422) && MODEL_GONE.test(raw))) return { outcome: "model_gone", latencyMs };
    if ((response.status === 400 || response.status === 422) && tools && TOOLS_REFUSED.test(raw)) return { outcome: "tools_unsupported", latencyMs };
    if (response.status === 408 || response.status === 504) return { outcome: "timeout", latencyMs };
    if (response.status >= 500) return { outcome: "upstream_error", latencyMs };
    if (!response.ok) return { outcome: "bad_request", latencyMs };
    let json: { model?: unknown; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; cost?: unknown }; choices?: Array<{ message?: { content?: unknown; tool_calls?: unknown } }> };
    try {
      json = JSON.parse(raw);
    } catch {
      return { outcome: "malformed", latencyMs };
    }
    const usage = readUsage(json);
    const model = typeof json.model === "string" ? json.model : undefined;
    const message = json.choices?.[0]?.message;
    const content = typeof message?.content === "string" ? message.content.trim() : "";
    const toolCalls = readToolCalls(message?.tool_calls);
    const extras = { ...(usage ? { usage } : {}), ...(model ? { model } : {}) };
    if (content.includes(input.secret) || toolCalls.some((call) => call.arguments.includes(input.secret))) return { outcome: "malformed", latencyMs, ...extras };
    if (toolCalls.length > 0) return { outcome: "ok", latencyMs, body: content, toolCalls, ...extras };
    if (!content) return { outcome: "empty", latencyMs, ...extras };
    return { outcome: "ok", latencyMs, body: content, ...extras };
  } catch (error) {
    return { outcome: timedOut(error) ? "timeout" : "failed", latencyMs: Date.now() - started };
  }
}

export async function publishLiveKitData(input: { url: string; apiKey: string; apiSecret: string; room: string; text: string; mode: string; now: Date }) {
  const endpoint = `${input.url.replace(/^ws/i, "http").replace(/\/$/, "")}/twirp/livekit.RoomService/SendData`;
  const token = signRoomAdminToken({ apiKey: input.apiKey, apiSecret: input.apiSecret, room: input.room, ttlSeconds: 60, now: input.now });
  const payload = JSON.stringify({ type: "tutor", text: input.text, mode: input.mode });
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ room: input.room, data: Buffer.from(payload).toString("base64"), kind: "RELIABLE" })
  });
  if (!response.ok) throw new Error("LiveKit chat publish failed.");
}
