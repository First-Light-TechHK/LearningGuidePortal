import { fetchOpenRouter } from "@/services/openRouterClient";
import { signRoomAdminToken } from "./liveKitToken";
import type { TutorKeyOutcome } from "./tutorKeyPool";

export const COURSE_MATERIAL_ABSENT = "The course material does not contain the answer.";

const STOP_WORDS = new Set(["what", "when", "where", "which", "that", "this", "with", "from", "have", "does", "about", "your", "into", "they", "them", "were", "been", "would", "could", "should", "their", "there", "again", "more", "than", "says", "said", "just", "only", "also", "very", "much", "many", "even", "still", "then", "here", "each", "both", "same", "most", "well", "back", "like", "over", "such", "some", "other", "why", "how", "relate", "related", "between", "give", "show", "tell", "please", "understanding", "check", "checks", "question", "questions", "quiz", "quizzes"]);

// Common Chinese framing words (kept as bigrams, matching the CJK expansion
// below) that carry no course content. Without these, a polite request such as
// \u8bf7\u4ecb\u7ecd\u4e00\u4e0bX would count mostly-missing framing bigrams and be refused as
// outside the course material even when X is covered.
const ZH_STOP_WORDS = new Set(["\u4ecb\u7ecd", "\u4e00\u4e0b", "\u5173\u4e8e", "\u4ec0\u4e48", "\u662f\u8c01", "\u544a\u8bc9", "\u8bf4\u8bf4", "\u8bb2\u8bb2", "\u89e3\u91ca", "\u5e2e\u6211", "\u80fd\u4e0d\u80fd", "\u53ef\u4ee5", "\u51fa\u4e00", "\u9053\u9898", "\u51fa\u9898"]);

function cjkQuestionTerms(run: string): string[] {
  // A contiguous CJK run carries no spaces, so the whole sentence matched as
  // one term can never be found in the course text. Use overlapping bigrams
  // for runs longer than two characters; the retrieval and the missing-term
  // ratio both operate on those.
  if (run.length <= 2) return [run];
  const terms: string[] = [];
  for (let index = 0; index < run.length - 1; index += 1) terms.push(run.slice(index, index + 2));
  return terms;
}

export function courseQuestionTerms(question: string) {
  return [
    ...(question.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []),
    ...(question.match(/[\u3400-\u9fff]{2,}/g) ?? []).flatMap((run) => cjkQuestionTerms(run))
  ].filter((term, index, all) => !STOP_WORDS.has(term) && !ZH_STOP_WORDS.has(term) && all.indexOf(term) === index);
}

export function retrieveCourseKnowledge(corpus: string, question: string) {
  const terms = courseQuestionTerms(question);
  if (!terms.length || !corpus.trim()) return "";
  const pieces = corpus.split(/\n\s*\n/).map((item) => item.trim()).filter((item) => item.length >= 12);
  const passages = pieces.length ? pieces : [corpus.trim()];
  const scored = passages.map((passage) => {
    const haystack = passage.toLowerCase();
    return { passage, hits: terms.filter((term) => haystack.includes(term.toLowerCase())).length };
  }).filter((item) => item.hits > 0).sort((left, right) => right.hits - left.hits);
  if (!scored.length) return "";
  return scored.slice(0, 4).map((item) => item.passage).join("\n\n").slice(0, 8000);
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

export async function openRouterTutorCall(input: { secret: string; model: string; system: string; context: string; text: string; url?: string }): Promise<{ outcome: TutorKeyOutcome; latencyMs: number; body?: string }> {
  const started = Date.now();
  const messages = [
    { role: "system", content: input.system },
    { role: "user", content: `<course_context>\n${input.context}\n</course_context>\n<participant_text>\n${input.text}\n</participant_text>\nAnswer the participant for the shared room.` }
  ];
  try {
    const compatibleUrl = input.url?.trim();
    const response = compatibleUrl && !compatibleUrl.includes("openrouter.ai")
      ? await fetch(compatibleUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${input.secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: input.model, temperature: 0.2, max_tokens: 600, stream: false, messages }),
        signal: AbortSignal.timeout(45_000)
      })
      : await fetchOpenRouter(input.secret, {
      model: input.model,
      temperature: 0.2,
      max_tokens: 600,
      stream: false,
      messages
    }, { timeoutMs: 45_000, attempts: 1 });
    const latencyMs = Date.now() - started;
    const raw = await response.text();
    if (response.status === 401 || response.status === 403) return { outcome: "auth_failed", latencyMs };
    if (response.status === 429) return { outcome: "rate_limited", latencyMs };
    if (response.status === 402 || /quota|insufficient_quota|credit/i.test(raw)) return { outcome: "quota", latencyMs };
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

export async function publishLiveKitData(input: { url: string; apiKey: string; apiSecret: string; room: string; text: string; now: Date }) {
  const endpoint = `${input.url.replace(/^ws/i, "http").replace(/\/$/, "")}/twirp/livekit.RoomService/SendData`;
  const token = signRoomAdminToken({ apiKey: input.apiKey, apiSecret: input.apiSecret, room: input.room, ttlSeconds: 60, now: input.now });
  const payload = JSON.stringify({ type: "tutor", text: input.text });
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ room: input.room, data: Buffer.from(payload).toString("base64"), kind: "RELIABLE" })
  });
  if (!response.ok) throw new Error("LiveKit chat publish failed.");
}
