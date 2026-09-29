import { NextRequest, NextResponse } from "next/server";
import { adminHostDecision } from "@/services/adminHost";

export function middleware(request: NextRequest) {
  const decision = adminHostDecision(request);
  if (decision.allow) return NextResponse.next();
  if (decision.status === 404) return new NextResponse("Not Found", { status: 404 });
  if (decision.status === 307 && decision.location) {
    return NextResponse.redirect(new URL(decision.location, request.url), 307);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
