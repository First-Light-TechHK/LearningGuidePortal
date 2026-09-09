import { NextResponse } from "next/server";
import { publicAppOrigin } from "./runtimeConfig";

// Host-only transaction cookies must be created on the callback host.
export function redirectToOAuthOrigin(request: Request) {
  const url = new URL(request.url);
  const origin = new URL(publicAppOrigin(request));
  const host = request.headers.get("x-forwarded-host")?.split(",")[0].trim()
    || request.headers.get("host") || url.host;
  const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0].trim()
    || url.protocol.slice(0, -1);
  if (host === origin.host && `${protocol}:` === origin.protocol) return null;
  const target = new URL(origin.origin);
  target.pathname = url.pathname;
  target.search = url.search;
  const response = NextResponse.redirect(target, 303);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
