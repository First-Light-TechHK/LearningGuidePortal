import { NextRequest, NextResponse } from "next/server";
import { readPublishedWiki } from "../../lib/wiki-store";
import { fetchOpenRouter, openRouterErrorMessage } from "../../../services/openRouterClient";
import { currentProductUserFromRequest } from "../../../services/productAuth";

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

export async function buildSystemPrompt(body: RequestBody) {
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
    "Client-supplied knowledge packs are ignored. Use only the published wiki markdown above.",
    "SOURCE EXCERPTS:",
    "",
    "PROMPT CONTRACT:",
    "- First validate whether the student turn is relevant to the current topic or the course context.",
    "- If relevant, use the course pack and source excerpts.",
    "- If the student asks an understanding-test style answer, assess it against the rubric.",
    "- When the course names a governing equation, write it in LaTeX using $...$ or $$...$$.",
    "- When the course names a figure, include it as a markdown image using the exact path in the course pack.",
    "- Do not invent a finished number when a needed quantity was not given, and do not close with a newspaper headline.",
    "- Keep the response suitable for a student, not a research seminar."
  ].join("\n\n");
}

export async function POST(request: NextRequest) {
  const user = await currentProductUserFromRequest(request);
  if (!user) return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });
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

  let upstream: Response;

  try {
    upstream = await fetchOpenRouter(apiKey, {
      model: body.model,
      messages,
      stream: true,
      reasoning: {
        effort: "none",
        exclude: true
      },
      temperature: body.mode === "socratic" ? 0.55 : 0.35,
      max_tokens: 900
    }, { timeoutMs: CHAT_TIMEOUT_MS });
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError"
      ? timeoutMessage(body.model)
      : openRouterErrorMessage(error);
    return new Response(message, { status: 504 });
  }

  if (!upstream.ok || !upstream.body) {
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
