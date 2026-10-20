import { fetchOpenRouter } from "@/services/openRouterClient";
import { signRoomAdminToken } from "./liveKitToken";
import type { TutorKeyOutcome } from "./tutorKeyPool";

// The reply contract (see tutorPrompt.ts): the first line is a tag — exactly
// COURSE or GENERAL. The tag may be bracketed ([COURSE] … / 【GENERAL】…) or
// bare; a bare tag may only be followed by a colon form or the end of the
// line, because a reply whose first word merely matches the tag — "Course
// material explains …" — is unverified prose and must default to GENERAL.
// That default is the fail-safe: nothing unverified may be presented as
// course content. Bold or italic wrapping around the tag (**COURSE**) is
// tolerated. The tag line is parsed off before the text is published.
const TAG_WORD = "course|general";
const BRACKETED_TAG = new RegExp(`^\\s*[\\[【]\\s*[*_]{0,2}(${TAG_WORD})[*_]{0,2}\\s*[\\]】]\\s*[:：\\-–—]?\\s*(.*)$`, "i");
const BARE_TAG = new RegExp(`^\\s*[*_]{0,2}(${TAG_WORD})[*_]{0,2}\\s*(?::\\s*(.*))?$`, "i");

export function parseTutorReply(raw: string): { mode: "course" | "general"; text: string } {
  const normalized = raw.replace(/\r\n?/g, "\n").trim();
  const newline = normalized.indexOf("\n");
  const firstLine = newline === -1 ? normalized : normalized.slice(0, newline);
  const rest = newline === -1 ? "" : normalized.slice(newline + 1);
  const match = BRACKETED_TAG.exec(firstLine) ?? BARE_TAG.exec(firstLine);
  if (!match) return { mode: "general", text: normalized };
  const tail = (match[2] ?? "").replace(/^[\s、。，,：:】\]]+/, "").trim();
  return {
    mode: match[1].toLowerCase() === "course" ? "course" : "general",
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

// The length cap follows the reply's script mix: 240 characters of Latin
// text, 120 of CJK text (a CJK character carries about twice as much), and
// in between in proportion to the share of CJK characters. One Chinese word
// in an English reply no longer halves its room (QA 2026-10-19 M22).
export function tutorReplyLimit(text: string) {
  const visible = text.replace(/\s+/g, "");
  if (!visible) return 240;
  const share = (visible.match(CJK_CHARACTER)?.length ?? 0) / visible.length;
  return Math.round(240 - 120 * share);
}

// Reply shape guard (defence in depth behind the prompt's reply_format): drop
// markdown, normalise bullets to "• ", keep at most four lines (the answer
// line plus three key points), and cap the total length (tutorReplyLimit). An
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
    .slice(0, 4);
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
  if (!shared || (url && !url.includes("openrouter.ai"))) return [];
  return [{ id: SHARED_TUTOR_KEY_ID, secret: shared }];
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

export async function openRouterTutorCall(input: { secret: string; model: string; system: string; context: string; text: string; url?: string; maxTokens?: number; reasoning?: { effort: string }; timeoutMs?: number }): Promise<{ outcome: TutorKeyOutcome; latencyMs: number; body?: string }> {
  const started = Date.now();
  const maxTokens = input.maxTokens ?? 700;
  // At most 45 s, and never past the caller's answer deadline.
  const timeoutMs = Math.max(1, Math.min(45_000, input.timeoutMs ?? 45_000));
  const messages = [
    { role: "system", content: input.system },
    { role: "user", content: `<course_material>\n${input.context}\n</course_material>\n<participant_text>\n${input.text}\n</participant_text>\nAnswer the participant message for the shared room, following the reply format exactly.` }
  ];
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
        body: JSON.stringify({ model: input.model, temperature: 0.2, max_tokens: maxTokens, stream: false, messages }),
        signal: AbortSignal.timeout(timeoutMs)
      })
      : await fetchOpenRouter(input.secret, {
      model: input.model,
      temperature: 0.2,
      max_tokens: maxTokens,
      ...(input.reasoning ? { reasoning: input.reasoning } : {}),
      stream: false,
      messages
    }, { timeoutMs, attempts: 1 });
    const latencyMs = Date.now() - started;
    const raw = await response.text();
    if (response.status === 401 || response.status === 403) return { outcome: "auth_failed", latencyMs };
    if (response.status === 429) return { outcome: "rate_limited", latencyMs };
    // Quota wording only decides on a failed response: a 200 completion whose
    // answer text happens to contain "credit" (attribution, course credit) is
    // a valid answer, not a quota signal.
    if (response.status === 402 || (!response.ok && /quota|insufficient_quota|credit/i.test(raw))) return { outcome: "quota", latencyMs };
    if (!response.ok) return { outcome: "failed", latencyMs };
    let content = "";
    try {
      const json = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string } }> };
      content = json.choices?.[0]?.message?.content?.trim() || "";
    } catch {
      return { outcome: "failed", latencyMs };
    }
    if (!content || content.includes(input.secret)) return { outcome: "failed", latencyMs };
    return { outcome: "ok", latencyMs, body: content };
  } catch {
    return { outcome: "failed", latencyMs: Date.now() - started };
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
