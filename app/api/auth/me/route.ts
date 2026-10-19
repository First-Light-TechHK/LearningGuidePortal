import { NextResponse } from "next/server";
import { currentProductUser } from "@/services/productAuth";
import { publicUser } from "@/services/productStore";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentProductUser();
  return NextResponse.json({ ok: true, user: user ? publicUser(user) : null });
}
