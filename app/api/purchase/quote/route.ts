import { NextResponse } from "next/server";
import { currentProductUser } from "@/services/productAuth";
import { createQuote } from "@/services/productStore";

export async function POST(request: Request) {
  const user = await currentProductUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });
  try {
    const body = await request.json() as { planId?: string };
    const result = await createQuote(user.id, body.planId || "");
    return NextResponse.json({ ok: true, quote: result.quote, plan: result.plan });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Price calculation failed." }, { status: 400 });
  }
}
