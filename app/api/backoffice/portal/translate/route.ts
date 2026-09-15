import { NextResponse } from "next/server";
import { currentOperatorUser } from "@/services/productAuth";
import { isOperator } from "@/services/productStore";
import { translatePortalContent } from "@/services/portalTranslate";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await currentOperatorUser();
  if (!user || !isOperator(user)) return NextResponse.json({ error: "Operator access required." }, { status: 403 });
  try {
    const body = await request.json() as { source?: string; content?: unknown };
    const source = body.source === "zh-CN" ? "zh-CN" : body.source === "en-GB" ? "en-GB" : null;
    if (!source || !body.content || typeof body.content !== "object") throw new Error("Choose a source language and provide portal content.");
    const result = await translatePortalContent(body.content as import("@/lib/portalContent").PortalContent, source);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Translation failed.";
    const status = message.includes("not configured") ? 503 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
