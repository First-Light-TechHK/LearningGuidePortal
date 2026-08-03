import { NextRequest } from "next/server";
import { readPublishedWiki } from "../../lib/wiki-store";

export const runtime = "nodejs";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type RequestBody = {
  topic?: string;
  model: string;
  mode: "lecture" | "socratic";
  message: string;
  history: ChatMessage[];
  prompts: {
    base: string;
    lecture: string;
    socratic: string;
  };
  knowledgePack: unknown;
  sources: string;
};

const CHAT_TIMEOUT_MS = 45_000;

function timeoutMessage(model: string) {
  return `OpenRouter request timed out after ${CHAT_TIMEOUT_MS / 1000}s for model ${model}. Try another model or retry later.`;
}

function lastTurns(history: ChatMessage[]) {
  return history.slice(-6);
}

async function buildSystemPrompt(body: RequestBody) {
  const modePrompt = body.mode === "lecture" ? body.prompts.lecture : body.prompts.socratic;
  const publishedWiki = await readPublishedWiki(body.topic || "Epicureanism");
  return [
    body.prompts.base,
    modePrompt,
    "CURRENT CONVERSATION TOPIC:",
    body.topic || "Epicureanism",
    "PUBLISHED KS WIKI MARKDOWN FOR THIS TOPIC:",
    publishedWiki.markdown || "No published wiki markdown found for this topic yet.",
    "COURSE PACK JSON:",
    JSON.stringify(body.knowledgePack, null, 2),
    "SOURCE EXCERPTS:",
    body.sources,
    "PROMPT CONTRACT:",
    "- First validate whether the student turn is relevant to Epicureanism or the course context.",
    "- If relevant, use the course pack and source excerpts.",
    "- If the student asks an understanding-test style answer, assess it against the rubric.",
    "- Keep the response suitable for a student, not a research seminar."
  ].join("\n\n");
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as RequestBody;
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return new Response("Missing OPENROUTER_API_KEY", { status: 500 });
  }

  const messages = [
    { role: "system", content: await buildSystemPrompt(body) },
    ...lastTurns(body.history),
    { role: "user", content: body.message }
  ];

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), CHAT_TIMEOUT_MS);
  let upstream: Response;

  try {
    upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: abortController.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "http://localhost:3007",
        "X-Title": process.env.OPENROUTER_APP_NAME || "KS AI Tutor Demo"
      },
      body: JSON.stringify({
        model: body.model,
        messages,
        stream: true,
        reasoning: {
          effort: "none",
          exclude: true
        },
        temperature: body.mode === "socratic" ? 0.55 : 0.35,
        max_tokens: 900
      })
    });
  } catch (error) {
    clearTimeout(timeout);
    const message = error instanceof Error && error.name === "AbortError"
      ? timeoutMessage(body.model)
      : error instanceof Error
        ? error.message
        : "OpenRouter request failed.";
    return new Response(message, { status: 504 });
  }

  if (!upstream.ok || !upstream.body) {
    clearTimeout(timeout);
    const text = await upstream.text();
    return new Response(text || `OpenRouter error ${upstream.status}`, {
      status: upstream.status || 500
    });
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (data === "[DONE]") continue;
            try {
              const json = JSON.parse(data);
              const choice = json.choices?.[0];
              const delta =
                choice?.delta?.content ||
                choice?.message?.content ||
                choice?.text ||
                "";
              if (delta) controller.enqueue(encoder.encode(delta));
            } catch {
              // Ignore partial provider metadata lines.
            }
          }
        }
      } catch (error) {
        controller.error(
          error instanceof Error && error.name === "AbortError"
            ? new Error(timeoutMessage(body.model))
            : error
        );
      } finally {
        clearTimeout(timeout);
        try {
          controller.close();
        } catch {
          // The stream may already be errored or closed by the client.
        }
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache"
    }
  });
}
