import { NextResponse } from "next/server";
import { confirmEmailBinding } from "@/services/productStore";
import { currentProductUserFromRequest } from "@/services/productAuth";
import { safeReturnTo } from "@/services/runtimeConfig";
import type { EmailBindingConfirmation } from "@/contracts/emailBinding";

export async function POST(request: Request) {
  try {
    const body = await request.json() as EmailBindingConfirmation;
    if (typeof body.token !== "string" || !body.token || (body.returnTo !== undefined && typeof body.returnTo !== "string")) throw new Error("invalid_link");
    const result = await confirmEmailBinding(body.token);
    const user = await currentProductUserFromRequest(request, true);
    const locale = body.locale === "zh-CN" ? "zh-CN" : "en-GB";
    const returnTo = safeReturnTo(body.returnTo, `/${locale}/account/my-learning`);
    const sameUser = user?.id === result.userId;
    return NextResponse.json({ ok: true, alreadyBound: result.alreadyBound, sameUser, continueUrl: sameUser ? returnTo : `/api/auth/wechat?${new URLSearchParams({ locale, returnTo })}` });
  } catch (error) {
    const code = error instanceof Error && error.message === "email_in_use" ? "email_in_use" : "invalid_link";
    return NextResponse.json({ ok: false, code }, { status: 400 });
  }
}
