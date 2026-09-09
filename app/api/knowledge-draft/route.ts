import { NextRequest } from "next/server";
import { rejectIfUnauthenticated } from "@/services/productAuth";
import { saveDraft } from "../../lib/wiki-store";

export const runtime = "nodejs";

type Body = {
  topic?: string;
  model: string;
  material: string;
  socraticPrompts?: string[];
  extractionRequirements?: string;
  currentPack?: unknown;
};

const DRAFT_TIMEOUT_MS = 45_000;

function trimForPrompt(value: string, maxChars: number) {
  return value.length > maxChars ? `${value.slice(0, maxChars)}\n\n[TRUNCATED]` : value;
}

function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced?.[1] || text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Model did not return JSON.");
  }
  return JSON.parse(raw.slice(start, end + 1));
}

async function requestJsonRepair({
  apiKey,
  model,
  content,
  signal
}: {
  apiKey: string;
  model: string;
  content: string;
  signal: AbortSignal;
}) {
  const repairPrompt = `
Repair the following malformed JSON into valid JSON only.

Requirements:
- Return exactly one JSON object.
- Preserve the same top-level keys and semantic content.
- Do not add markdown, comments, explanations, or trailing commas.
- If a list item is incomplete, finish it briefly.

Malformed JSON:
${trimForPrompt(content, 12000)}
`;

  const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "http://localhost:3007",
      "X-Title": process.env.OPENROUTER_APP_NAME || "KS AI Tutor Demo"
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: "You repair malformed JSON. Return valid JSON only."
        },
        { role: "user", content: repairPrompt }
      ],
      temperature: 0,
      max_tokens: 1800,
      response_format: { type: "json_object" },
      reasoning: { effort: "none", exclude: true }
    })
  });

  if (!upstream.ok) {
    const text = await upstream.text();
    throw new Error(text || `OpenRouter JSON repair error ${upstream.status}`);
  }

  const data = await upstream.json();
  const repaired = data.choices?.[0]?.message?.content || "";
  return extractJson(repaired);
}

export async function POST(request: NextRequest) {
  const denied = await rejectIfUnauthenticated(request);
  if (denied) return denied;
  const body = (await request.json()) as Body;
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return Response.json({ error: "Missing OPENROUTER_API_KEY" }, { status: 500 });
  }

  const prompt = `
Create an editable KS Wiki article draft for an AI Tutor topic: ${body.topic || "Epicureanism"}.

Return ONLY valid JSON with this exact shape:
{
  "topic": "...",
  "title": "...",
  "status": "AI Draft",
  "summary": "...",
  "sections": [
    { "title": "Definition", "body": "...", "bullets": [] },
    { "title": "Key Points", "body": "", "bullets": ["..."] },
    { "title": "Common Misunderstandings", "body": "", "bullets": ["Misconception: ...", "Clarification: ..."] },
    { "title": "Teaching Example", "body": "...", "bullets": [] },
    { "title": "Follow-up Questions", "body": "", "bullets": ["..."] }
  ],
  "sourceReferences": ["..."],
  "learningObjectives": ["..."],
  "sourcePriorities": ["..."],
  "misunderstandingMaps": [{"misunderstanding": "...", "correction": "..."}],
  "teachingSequences": ["..."],
  "socraticPromptPatterns": ["..."],
  "editorialStandards": ["..."],
  "answerRubric": ["..."],
  "materialDigest": "..."
}

Use the professor material. Keep it practical for runtime prompt-package generation.
Use the professor Socratic prompts as teaching intent and discussion style evidence.
Follow the human extraction requirements when deciding which wiki entries to extract.
Do not invent long scholarly apparatus. Do not write generic AI product copy.

Human extraction requirements:
${body.extractionRequirements || "Create the most useful wiki article entries from the provided materials."}

Professor material:
${trimForPrompt(body.material || "", 18000)}

Professor Socratic prompts:
${(body.socraticPrompts || []).map((item, index) => `${index + 1}. ${item}`).join("\n") || "None provided."}

Current pack for reference:
${JSON.stringify(body.currentPack || {}, null, 2)}
`;

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), DRAFT_TIMEOUT_MS);

  try {
    const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
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
        messages: [
          {
            role: "system",
            content:
              "You convert professor course materials into compact, editable AI Tutor teaching controls. Return strict JSON only."
          },
          { role: "user", content: prompt }
        ],
        temperature: 0.2,
        max_tokens: 1600,
        response_format: { type: "json_object" },
        reasoning: { effort: "none", exclude: true }
      })
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return Response.json({ error: text || `OpenRouter error ${upstream.status}` }, { status: upstream.status || 500 });
    }

    const data = await upstream.json();
    const content = data.choices?.[0]?.message?.content || "";
    try {
      const draft = extractJson(content);
      await saveDraft(body.topic || draft.topic || "Epicureanism", draft);
      return Response.json({ draft });
    } catch {
      const repairedDraft = await requestJsonRepair({
        apiKey,
        model: body.model,
        content,
        signal: abortController.signal
      });
      await saveDraft(body.topic || repairedDraft.topic || "Epicureanism", repairedDraft);
      return Response.json({ draft: repairedDraft });
    }
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? `OpenRouter request timed out after ${DRAFT_TIMEOUT_MS / 1000}s for model ${body.model}.`
      : error instanceof Error
        ? error.message
        : "Draft generation failed.";
    return Response.json({ error: message }, { status: 500 });
  } finally {
    clearTimeout(timeout);
  }
}
