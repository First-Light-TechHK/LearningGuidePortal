import { NextResponse } from "next/server";
import { currentProductUser } from "@/services/productAuth";
import { getCoursePage } from "@/services/productStore";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await currentProductUser();
  const page = await getCoursePage(slug, user?.id ?? null);
  return NextResponse.json({ ok: true, page });
}
