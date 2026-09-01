export function appEnvironment() {
  return (process.env.APP_ENV || process.env.NODE_ENV || "DEV").trim().toUpperCase();
}

export function isProductionEnvironment() {
  return ["PROD", "PPE/PROD"].includes(appEnvironment());
}

export function appOrigin(request?: Request) {
  // In local development the browser host is authoritative. This keeps redirects and
  // cookies on 127.0.0.1 when the developer opened that host instead of localhost.
  if (!isProductionEnvironment()) {
    const host = request?.headers.get("x-forwarded-host") || request?.headers.get("host");
    const protocol = request?.headers.get("x-forwarded-proto") || new URL(request?.url || "http://localhost:3000").protocol.replace(":", "");
    if (host) return `${protocol}://${host}`;
    return new URL(request?.url || "http://localhost:3000").origin;
  }
  return process.env.NEXT_PUBLIC_APP_URL?.trim() || request?.headers.get("origin") || "http://localhost:3000";
}

export function safeReturnTo(value: string | null | undefined, fallback: string) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : fallback;
}
