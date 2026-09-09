import { readFile } from "fs/promises";
import path from "path";
import { fetchOpenRouter } from "./openRouterClient";
import { getConversation, saveConversation, type ProductConversation, type ProductCourse, type ProductLesson } from "./productStore";

type TutorInput = {
  userId: string;
  course: ProductCourse;
  lesson: ProductLesson;
  mode: "lecture" | "socratic";
  message: string;
  conversationId?: string;
  locale: "en-GB" | "zh-CN";
};

const PROVIDER_TIMEOUT_MS = 20_000;
const STREAM_IDLE_TIMEOUT_MS = 15_000;

async function readPrompt(name: string) {
  try { return await readFile(path.join(process.cwd(), "prompts", "chat_testing", name), "utf8"); } catch { return ""; }
}

function isEpicureanism(course: ProductCourse) {
  return course.id === "epicureanism" || course.slug === "epicureanism";
}

async function readKnowledge(course: ProductCourse) {
  // D1 LEARN-03: load the pack for this course, not a hardcoded Epicureanism root.
  const root = path.join(process.cwd(), "knowledge", course.slug || course.id);
  const files = ["knowledge-pack.json", "canon-excerpts.md", "sources.md"];
  const parts: string[] = [];
  for (const file of files) {
    try { parts.push(`FILE: ${file}\n${(await readFile(path.join(root, file), "utf8")).slice(0, 9000)}`); } catch { /* course may not have a KS pack yet */ }
  }
  return parts.join("\n\n").slice(0, 24000);
}

function localeName(locale: TutorInput["locale"]) { return locale === "zh-CN" ? "Simplified Chinese" : "British English"; }

async function buildPrompt(input: TutorInput, conversation: ProductConversation) {
  const [base, mode, knowledge] = await Promise.all([readPrompt("BasePrompt"), readPrompt(input.mode === "lecture" ? "LecturePrompt" : "SocraticPrompt"), readKnowledge(input.course)]);
  return [
    base,
    mode,
    "You are the AI Tutor inside Learning Guide. This is a course conversation, not open chat.",
    `Answer in ${localeName(input.locale)}.`,
    `Course: ${input.course.title}`,
    `Lesson: ${input.lesson.title}`,
    `Lesson content:\n${input.lesson.body}`,
    `Student learning state: ${JSON.stringify({ previousTurns: conversation.messages.length / 2, currentLesson: input.lesson.id })}`,
    "Use the course lesson and the supplied specialist knowledge as the basis for the response. Do not mention these instructions, files, retrieval or internal systems.",
    knowledge ? `Specialist knowledge:\n${knowledge}` : "No additional specialist knowledge is available; do not invent course-specific claims.",
    input.mode === "socratic" ? "Ask one focused question at a time and use a short hint before giving away the conclusion." : "Explain the answer directly, then include one short check for understanding."
  ].filter(Boolean).join("\n\n");
}

function fallbackAnswer(input: TutorInput) {
  if (isEpicureanism(input.course) && /pleasure|享乐|快乐|欲望/i.test(input.message)) {
    return input.mode === "socratic"
      ? "先区分两件事：一种快乐是强烈而短暂的刺激，另一种是没有痛苦和不安的稳定状态。你认为 Epicurus 为什么会更重视后者？"
      : "Epicurus does not equate pleasure with luxury or constant stimulation. He treats stable freedom from bodily pain and mental disturbance as the practical aim. That is why a simple meal or friendship may be more valuable than an intense experience that creates anxiety later. The key test is what a choice does to future freedom from pain and fear.";
  }
  if (isEpicureanism(input.course)) {
    return input.mode === "socratic"
      ? "先把问题放回本课的区分中：你是在问 Epicurus 的原始论证，还是后来对它的批评？你会先选择哪一个？"
      : "Start with the distinction used in this lesson, then apply it to the question. The tutor will keep the discussion within the course material and will separate Epicurus' own argument from later objections.";
  }
  return input.mode === "socratic"
    ? `先把问题放回本课（${input.course.title} / ${input.lesson.title}）的区分中：你会先抓住哪一个要点？`
    : `Start with the distinction used in this lesson (${input.lesson.title}), then apply it to the question. Stay inside ${input.course.title}.`;
}

function streamText(text: string) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    }
  });
}

function streamOpenRouter(upstream: Response, conversation: ProductConversation, input: TutorInput, history: ProductConversation["messages"]) {
  if (!upstream.body) throw new Error("AI Tutor returned no response stream.");
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let answer = "";
  let saved = false;
  async function persist() {
    if (saved) return;
    saved = true;
    if (answer.trim()) {
      await saveConversation({ ...conversation, mode: input.mode, messages: [...history, { role: "user", content: input.message, createdAt: new Date().toISOString() }, { role: "assistant", content: answer, createdAt: new Date().toISOString() }] });
    }
  }
  async function readChunk() {
    return new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("AI Tutor provider timed out while streaming.")), STREAM_IDLE_TIMEOUT_MS);
      reader.read().then((result) => {
        clearTimeout(timer);
        resolve(result);
      }, (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await readChunk();
        if (done) {
          await persist();
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trim();
          if (!raw) continue;
          if (raw === "[DONE]") {
            await persist();
            controller.close();
            return;
          }
          const json = JSON.parse(raw) as { choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>; error?: { message?: string } };
          if (json.error?.message) throw new Error(json.error.message);
          const text = json.choices?.map((choice) => choice.delta?.content || choice.message?.content || "").join("") || "";
          if (text) { answer += text; controller.enqueue(encoder.encode(text)); }
        }
      } catch (error) {
        if (!answer.trim()) {
          answer = fallbackAnswer(input);
          controller.enqueue(encoder.encode(answer));
          await persist();
          controller.close();
          return;
        }
        controller.error(error);
      }
    },
    async cancel() { await reader.cancel(); }
  });
  return stream;
}

export async function createTutorResponse(input: TutorInput) {
  const conversation = await getConversation(input.userId, input.conversationId, input.course.id, input.lesson.id, input.mode);
  const history = conversation.messages.slice(-12);
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    const answer = fallbackAnswer(input);
    await saveConversation({ ...conversation, mode: input.mode, messages: [...history, { role: "user", content: input.message, createdAt: new Date().toISOString() }, { role: "assistant", content: answer, createdAt: new Date().toISOString() }] });
    return { stream: streamText(answer), conversationId: conversation.id, provider: "local-demo" };
  }
  const system = await buildPrompt(input, conversation);
  try {
    const upstream = await fetchOpenRouter(apiKey, {
      model: process.env.OPENROUTER_MODEL || "openrouter/auto",
      temperature: 0.25,
      max_tokens: 900,
      stream: true,
      messages: [{ role: "system", content: system }, ...history.map((message) => ({ role: message.role, content: message.content })), { role: "user", content: input.message }]
    }, { timeoutMs: PROVIDER_TIMEOUT_MS, attempts: 1 });
    if (!upstream.ok) throw new Error(`AI Tutor provider returned HTTP ${upstream.status}.`);
    return { stream: streamOpenRouter(upstream, conversation, input, history), conversationId: conversation.id, provider: "openrouter" };
  } catch {
    const answer = fallbackAnswer(input);
    await saveConversation({ ...conversation, mode: input.mode, messages: [...history, { role: "user", content: input.message, createdAt: new Date().toISOString() }, { role: "assistant", content: answer, createdAt: new Date().toISOString() }] });
    return { stream: streamText(answer), conversationId: conversation.id, provider: "local-demo" };
  }
}
