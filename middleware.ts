import { NextRequest, NextResponse } from "next/server";
import { adminHostDecision } from "@/services/adminHost";

export function middleware(request: NextRequest) {
  if ((process.env.APP_ENV || "").toUpperCase() === "DEV") {
    const canonical = process.env.WECHAT_DEV_ORIGIN?.trim();
    if (canonical) {
      try {
        const target = new URL(canonical);
        const host = request.headers.get("x-forwarded-host")?.split(",")[0].trim() || request.headers.get("host") || request.nextUrl.host;
        if (target.protocol === "https:" && target.hostname.startsWith("www.") && host === target.hostname.slice(4)) {
          const redirect = new URL(request.nextUrl);
          redirect.host = target.host;
          redirect.protocol = "https:";
          return NextResponse.redirect(redirect, 308);
        }
      } catch { /* Invalid configuration is caught by auth readiness. */ }
    }
  }
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
