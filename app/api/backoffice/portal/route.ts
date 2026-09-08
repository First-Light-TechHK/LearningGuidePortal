import { NextResponse } from "next/server";
import { currentProductUser } from "@/services/productAuth";
import { getPortalContent, isOperator, savePortalContent } from "@/services/productStore";

export async function GET() {
  const user = await currentProductUser();
  if (!user || !isOperator(user)) return NextResponse.json({ error: "Operator access required." }, { status: 403 });
  return NextResponse.json({ content: await getPortalContent() });
}
export async function PUT(request: Request) {
  const user = await currentProductUser();
  if (!user || !isOperator(user)) return NextResponse.json({ error: "Operator access required." }, { status: 403 });
  try { return NextResponse.json({ content: await savePortalContent(await request.json()) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Save failed." }, { status: 400 }); }
}
