import { NextResponse } from "next/server";
import { currentProductUser } from "@/services/productAuth";
import { getLearningOverview } from "@/services/productStore";
import { changeUserSubscription } from "@/services/subscriptionManagementService";
import { parseSubscriptionChange, SubscriptionManagementError } from "@/contracts/subscription-management";
import { getMessages } from "@/lib/i18n/messages";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentProductUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });
  return NextResponse.json({ ok: true, subscriptions: (await getLearningOverview(user.id)).subscriptions });
}

export async function POST(request: Request) {
  const user = await currentProductUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });
  try {
    const subscription = await changeUserSubscription(user.id, parseSubscriptionChange(await request.json()));
    return NextResponse.json({ ok: true, subscription });
  } catch (error) {
    const code = error instanceof SubscriptionManagementError ? error.code : error instanceof SyntaxError ? "invalid" : "provider_unavailable";
    const message = getMessages(user.locale).subscriptionErrors[code];
    return NextResponse.json({ ok: false, code, error: message, message }, { status: error instanceof SubscriptionManagementError ? error.status : code === "invalid" ? 400 : 503 });
  }
}
