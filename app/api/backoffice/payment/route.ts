import { NextResponse } from "next/server";
import { currentProductUser } from "@/services/productAuth";
import { getPaymentSettings, isOperator, updatePaymentSettings } from "@/services/productStore";

export const dynamic = "force-dynamic";

async function operatorOnly() {
  const user = await currentProductUser();
  return user && isOperator(user) ? user : null;
}

export async function GET() {
  if (!await operatorOnly()) return NextResponse.json({ ok: false, error: "Course Manager/Operator access is required." }, { status: 403 });
  return NextResponse.json({ ok: true, settings: await getPaymentSettings() });
}

export async function PATCH(request: Request) {
  if (!await operatorOnly()) return NextResponse.json({ ok: false, error: "Course Manager/Operator access is required." }, { status: 403 });
  try {
    const body = await request.json() as { name?: string; publishableKey?: string; returnUrl?: string; paymentNotifications?: boolean };
    const settings = await updatePaymentSettings({ name: body.name || "", publishableKey: body.publishableKey || "", returnUrl: body.returnUrl || "", paymentNotifications: body.paymentNotifications !== false });
    return NextResponse.json({ ok: true, settings });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Payment settings could not be saved." }, { status: 400 });
  }
}
