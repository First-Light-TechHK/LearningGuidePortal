export function appEnvironment() {
  return (process.env.APP_ENV || process.env.NODE_ENV || "DEV").trim().toUpperCase();
}

export function isProductionEnvironment() {
  return ["PROD", "PPE/PROD"].includes(appEnvironment());
}

export function appOrigin(request?: Request) {
  return process.env.NEXT_PUBLIC_APP_URL?.trim() || request?.headers.get("origin") || "http://localhost:3000";
}

export function safeReturnTo(value: string | null | undefined, fallback: string) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : fallback;
}
