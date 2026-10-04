import { NextResponse } from "next/server";
import { isWechatAuthHost, redeemWechatTicket, verifyHandoffSecret, wechatHandoffEnabled, type WeChatEnvironment } from "@/services/wechatHandoff";

export async function POST(request: Request) {
  if (!wechatHandoffEnabled() || !isWechatAuthHost(request)) return new NextResponse("Not Found", { status: 404 });
  const env = request.headers.get("x-wechat-environment") as WeChatEnvironment | null;
  if (!env || !["DEV", "SIT", "UAT"].includes(env)) return new NextResponse("Unauthorized", { status: 401 });
  try {
    if (!verifyHandoffSecret(env, request.headers.get("authorization")?.replace(/^Bearer /, "") || null)) return new NextResponse("Unauthorized", { status: 401 });
    const body = await request.json() as { ticket?: unknown };
    const result = typeof body.ticket === "string" ? await redeemWechatTicket(body.ticket, env) : null;
    return NextResponse.json({ ok: Boolean(result), result }, { status: result ? 200 : 400, headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
