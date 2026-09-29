import { NextResponse } from "next/server";
import { currentProductUser } from "@/services/productAuth";
import { publicUser, updateUserProfile } from "@/services/productStore";

export async function GET(request: Request) {
  const user = await currentProductUser(request);
  if (!user) return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });
  return NextResponse.json({ ok: true, user: publicUser(user) });
}

export async function PATCH(request: Request) {
  const user = await currentProductUser(request);
  if (!user) return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });
  try {
    const body = await request.json() as { nickname?: string; locale?: "en-GB" | "zh-CN"; country?: string | null; ageRange?: string | null; education?: string | null; areasOfInterest?: string[]; currentPassword?: string; newPassword?: string };
    const updated = await updateUserProfile({
      userId: user.id,
      nickname: body.nickname || "",
      locale: body.locale === "zh-CN" ? "zh-CN" : "en-GB",
      country: body.country,
      ageRange: body.ageRange,
      education: body.education,
      areasOfInterest: body.areasOfInterest,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
    });
    return NextResponse.json({ ok: true, user: publicUser(updated) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Profile update failed." }, { status: 400 });
  }
}
