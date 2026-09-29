import { NextResponse } from "next/server";
import { currentProductUser } from "@/services/productAuth";
import { publicUser } from "@/services/productStore";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await currentProductUser(request);
  return NextResponse.json({ ok: true, user: user ? publicUser(user) : null });
}
