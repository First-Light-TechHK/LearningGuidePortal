import type { TutorReplyKind } from "./tutorAnswer";
import type { TutorToolSpec } from "./tutorAnswer";
import type { TutorToolCall } from "./tutorKeyPool";

// The room's AI Tutor memory: what it was asked and what it answered in this
// Live Session, oldest first. The server builds it from its own durable
// records (the answered questions and their room messages), never from what
// a browser says happened (tutor infra 2026-10-20).
export type TutorExchange = {
  question: string;
  answer: string;
  kind: TutorReplyKind;
  mode: "course" | "general";
  answeredAt: string;
};

// The latest understanding-check question stays open this long: an answer to
// it from the group is graded against it, a later one is a new question.
export const TUTOR_QUIZ_OPEN_MS = 15 * 60_000;
// Exchanges written into every call; older ones are a tool call away.
export const TUTOR_INLINE_EXCHANGES = 3;
// The most exchanges the history tool hands back.
export const TUTOR_HISTORY_TOOL_MAX = 12;

export function openTutorQuiz(history: TutorExchange[], nowMs: number) {
  const last = history.at(-1);
  if (!last || last.kind !== "quiz") return null;
  return nowMs - Date.parse(last.answeredAt) <= TUTOR_QUIZ_OPEN_MS ? last : null;
}

function minutesAgo(at: string, nowMs: number) {
  return Math.max(0, Math.round((nowMs - Date.parse(at)) / 60_000));
}

// The room context block of one call: the latest exchanges and the open
// understanding check, if any. Questions and answers are room content — the
// prompt treats the block as untrusted data, like the participant text.
export function renderRoomContext(history: TutorExchange[], nowMs: number) {
  const recent = history.slice(-TUTOR_INLINE_EXCHANGES);
  const quiz = openTutorQuiz(history, nowMs);
  if (!recent.length) return "";
  const lines = recent.map((item) => `[${minutesAgo(item.answeredAt, nowMs)} min ago] Participant asked: ${item.question}\nYou ${item.kind === "quiz" ? "asked the group (understanding check)" : "answered"}: ${item.answer}`);
  if (quiz) lines.push(`Open understanding check (asked ${minutesAgo(quiz.answeredAt, nowMs)} min ago): ${quiz.answer}`);
  if (history.length > recent.length) lines.push(`${history.length - recent.length} earlier exchange(s) are available through get_room_history.`);
  return lines.join("\n");
}

// The tools one call may use, over this room's records only. Every tool is
// read-only and answers from data the server already holds; arguments are
// validated and a bad call gets an error string, never an exception. The
// course knowledge tools (search_course_knowledge, get_lesson) join this
// registry when the Knowledge System module is integrated; until then the
// course material goes in the prompt as before (owner, 2026-10-20).
export function roomTutorTools(input: { history: TutorExchange[]; nowMs: number }) {
  const specs: TutorToolSpec[] = [
    {
      name: "get_room_history",
      description: "Earlier AI Tutor questions and answers in this Live Session, newest last. Use it when the participant refers to something said before that is not in room_context.",
      parameters: {
        type: "object",
        properties: { limit: { type: "integer", minimum: 1, maximum: TUTOR_HISTORY_TOOL_MAX, description: "How many of the latest exchanges to return." } },
        required: [],
        additionalProperties: false
      }
    },
    {
      name: "get_open_quiz",
      description: "The understanding-check question you last asked this group, if it is still open. Use it to grade a participant's answer.",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false }
    }
  ];
  async function run(call: TutorToolCall): Promise<string> {
    let args: Record<string, unknown> = {};
    try {
      const parsed = call.arguments.trim() ? JSON.parse(call.arguments) as unknown : {};
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
    } catch {
      return JSON.stringify({ error: "arguments must be a JSON object" });
    }
    if (call.name === "get_room_history") {
      const requested = typeof args.limit === "number" && Number.isFinite(args.limit) ? Math.floor(args.limit) : TUTOR_HISTORY_TOOL_MAX;
      const limit = Math.min(TUTOR_HISTORY_TOOL_MAX, Math.max(1, requested));
      return JSON.stringify(input.history.slice(-limit).map((item) => ({ question: item.question, answer: item.answer, kind: item.kind, minutesAgo: minutesAgo(item.answeredAt, input.nowMs) })));
    }
    if (call.name === "get_open_quiz") {
      const quiz = openTutorQuiz(input.history, input.nowMs);
      return JSON.stringify(quiz ? { question: quiz.answer, minutesAgo: minutesAgo(quiz.answeredAt, input.nowMs) } : { open: false });
    }
    return JSON.stringify({ error: `unknown tool ${call.name}` });
  }
  return { specs, run };
}
