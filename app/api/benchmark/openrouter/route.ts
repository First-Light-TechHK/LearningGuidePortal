import { NextRequest, NextResponse } from "next/server";
import { currentProductUserFromRequest } from "@/services/productAuth";

const GEMINI_MODEL = /^google\/gemini-/i;

export async function POST(req: NextRequest) {
  const user = await currentProductUserFromRequest(req);
  if (!user) return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing OPENROUTER_API_KEY" }, { status: 500 });
  }

  let body: {
    model?: string;
    messages?: { role: string; content: string }[];
    max_tokens?: number;
    temperature?: number;
    response_format?: unknown;
    session_id?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const model = body.model?.trim();
  const messages = body.messages;
  if (!model || !Array.isArray(messages) || !messages.length) {
    return NextResponse.json({ error: "model and messages are required" }, { status: 400 });
  }

  const payload: Record<string, unknown> = {
    model,
    messages,
    max_tokens: body.max_tokens ?? 900,
    temperature: body.temperature ?? 0,
    session_id: body.session_id || `d5-benchmark-${Date.now()}`
  };
  if (body.response_format) payload.response_format = body.response_format;
  // Gemini endpoints reject disabled reasoning; keep it enabled for those models only.
  if (!GEMINI_MODEL.test(model)) {
    payload.reasoning = { effort: "none", exclude: true };
  }

  const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "https://aitutor-k1ng.onrender.com",
      "X-Title": process.env.OPENROUTER_APP_NAME || "KS D5 Assessment Benchmark"
    },
    body: JSON.stringify(payload)
  });

  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" }
  });
}
