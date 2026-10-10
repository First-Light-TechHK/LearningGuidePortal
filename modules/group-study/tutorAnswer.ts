import { fetchOpenRouter } from "@/services/openRouterClient";
import { signRoomAdminToken } from "./liveKitToken";
import type { TutorKeyOutcome } from "./tutorKeyPool";

export const COURSE_MATERIAL_ABSENT = "The course material does not contain the answer.";

const STOP_WORDS = new Set(["what", "when", "where", "which", "that", "this", "with", "from", "have", "does", "about", "your", "into", "they", "them", "were", "been", "would", "could", "should", "their", "there", "again", "more", "than", "says", "said", "just", "only", "also", "very", "much", "many", "even", "still", "then", "here", "each", "both", "same", "most", "well", "back", "like", "over", "such", "some", "other", "why", "how", "relate", "related", "between"]);

export function courseQuestionTerms(question: string) {
  return [
    ...(question.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []),
    ...(question.match(/[\u3400-\u9fff]{2,}/g) ?? [])
  ].filter((term, index, all) => !STOP_WORDS.has(term) && all.indexOf(term) === index);
}

export function groundTutorReply(question: string, context: string, reply: string) {
  const text = reply.trim();
  if (!text || text.includes(COURSE_MATERIAL_ABSENT)) return COURSE_MATERIAL_ABSENT;
  const haystack = context.toLowerCase();
  const replyText = text.toLowerCase();
  const missing = courseQuestionTerms(question).filter((term) => !haystack.includes(term.toLowerCase()));
  if (missing.some((term) => replyText.includes(term.toLowerCase()))) return COURSE_MATERIAL_ABSENT;
  return text;
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
  const missing = courseQuestionTerms(input.text).filter((term) => !input.context.toLowerCase().includes(term.toLowerCase()));
  const limit = missing.length
    ? `\n\nThese question words are not in the course context: ${missing.join(", ")}. Do not explain them. If the question needs one of them, reply with exactly: ${COURSE_MATERIAL_ABSENT}`
    : "";
  const messages = [
    { role: "system", content: input.system },
    { role: "user", content: `Course context:\n${input.context}\n\nParticipant text:\n${input.text}${limit}` }
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
    if (response.status === 401 || response.status === 403) return { outcome: "failed", latencyMs };
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
