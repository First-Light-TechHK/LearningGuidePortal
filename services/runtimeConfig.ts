import { subscriptionPrices } from "@/contracts/payment";

export function appEnvironment() {
  return (process.env.APP_ENV || process.env.NODE_ENV || "DEV").trim().toUpperCase();
}

export function isProductionEnvironment() {
  return ["PROD", "PPE/PROD"].includes(appEnvironment());
}

export function isManagedEnvironment() {
  return ["SIT", "UAT", "PROD", "PPE/PROD", "PRODUCTION"].includes(appEnvironment());
}

export function localResetPreviewAllowed(request: Request) {
  const url = new URL(request.url);
  return appEnvironment() === "DEV" && process.env.STORAGE_BACKEND === "local"
    && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

export function secureAuthCookie(request: Request) {
  if (appEnvironment() !== "DEV") return true;
  const url = new URL(request.url);
  return !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
}

export function emailVerificationRequired() {
  if (isManagedEnvironment()) return true;
  return process.env.EMAIL_VERIFICATION_REQUIRED?.trim() !== "0";
}

export function paymentMode() {
  return (process.env.PAYMENT_MODE || "demo").trim().toLowerCase();
}

export function publicAppOrigin(request?: Request) {
  // Server redirects must use runtime configuration when one image is promoted across environments.
  const environment = process.env;
  const configured = environment.NEXT_PUBLIC_APP_URL?.trim();
  if (isManagedEnvironment()) {
    if (!configured) throw new Error("NEXT_PUBLIC_APP_URL is required in production.");
    let parsed: URL;
    try {
      parsed = new URL(configured);
    } catch {
      throw new Error("NEXT_PUBLIC_APP_URL must be a valid absolute URL.");
    }
    if (parsed.protocol !== "https:") throw new Error("NEXT_PUBLIC_APP_URL must use HTTPS in production.");
    return parsed.origin;
  }
  if (configured) {
    try {
      const parsed = new URL(configured);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
      return parsed.origin;
    } catch {
      throw new Error("NEXT_PUBLIC_APP_URL must be a valid HTTP or HTTPS URL.");
    }
  }
  return appOrigin(request);
}

function hasEnv(name: string) {
  return Boolean(process.env[name]?.trim());
}

export function runtimeConfiguration() {
  const production = isManagedEnvironment();
  const socialLocal = appEnvironment() === "DEV" && process.env.LOCAL_SOCIAL_LOGIN !== "0";
  const google = hasEnv("GOOGLE_CLIENT_ID") && hasEnv("GOOGLE_CLIENT_SECRET");
  const wechat = hasEnv("WECHAT_APP_ID") && hasEnv("WECHAT_APP_SECRET");
  const stripeSecret = hasEnv("STRIPE_SECRET_KEY");
  const stripeWebhook = hasEnv("STRIPE_WEBHOOK_SECRET");
  const publicUrl = hasEnv("NEXT_PUBLIC_APP_URL");
  const persistentStorage = Boolean(process.env.DATABASE_URL?.trim() && process.env.DATA_S3_BUCKET?.trim()) && process.env.STORAGE_BACKEND !== "local";
  const email = hasEnv("SES_FROM_EMAIL") || (hasEnv("SMTP_HOST") && hasEnv("SMTP_USER") && hasEnv("SMTP_PASS"));
  const emailVerification = emailVerificationRequired();
  const openRouter = hasEnv("OPENROUTER_API_KEY");
  const sessionSecret = Boolean(process.env.SESSION_SECRET?.trim() && (process.env.SESSION_SECRET?.trim().length || 0) >= 32);
  const payment = paymentMode();
  const required: string[] = [];
  if (production && !publicUrl) required.push("NEXT_PUBLIC_APP_URL");
  if (production && publicUrl && !/^https:\/\//i.test(process.env.NEXT_PUBLIC_APP_URL || "")) required.push("HTTPS NEXT_PUBLIC_APP_URL");
  if (production && process.env.LOCAL_SOCIAL_LOGIN !== "0") required.push("LOCAL_SOCIAL_LOGIN=0");
  if (production && !sessionSecret) required.push("SESSION_SECRET (at least 32 characters)");
  if (["SIT", "UAT"].includes(appEnvironment()) && (process.env.STRIPE_SANDBOX !== "1" || !process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_"))) required.push("Stripe sandbox test credentials");
  if (production && !persistentStorage) required.push("DATABASE_URL + DATA_S3_BUCKET (and STORAGE_BACKEND must not be local)");
  if (production && payment !== "stripe") required.push("PAYMENT_MODE=stripe");
  if (production && payment === "stripe" && !stripeSecret) required.push("STRIPE_SECRET_KEY");
  if (production && payment === "stripe" && !stripeWebhook) required.push("STRIPE_WEBHOOK_SECRET");
  if (payment === "stripe") for (const price of subscriptionPrices) if (!hasEnv(price.env)) required.push(price.env);
  if (production && !google) required.push("GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET");
  if (production && !wechat) required.push("WECHAT_APP_ID + WECHAT_APP_SECRET");
  if (emailVerification && !email) required.push("SES_FROM_EMAIL or SMTP_HOST + SMTP_USER + SMTP_PASS");
  if (production && !openRouter) required.push("OPENROUTER_API_KEY");
  if ((google || wechat) && !sessionSecret) required.push("SESSION_SECRET (at least 32 characters)");
  return {
    environment: appEnvironment(),
    production: isProductionEnvironment(),
    managed: production,
    publicUrl: publicUrl ? "configured" : "missing",
    storage: persistentStorage ? "postgresql+s3" : "local",
    payment: {
      mode: payment,
      configured: payment === "demo" ? !production : stripeSecret && stripeWebhook && publicUrl,
      stripeSecret: stripeSecret ? "configured" : "missing",
      stripeWebhook: stripeWebhook ? "configured" : "missing",
      lookupKeys: Object.fromEntries(subscriptionPrices.map(price => [price.id, hasEnv(price.env) ? "configured" : "missing"]))
    },
    authentication: {
      google: google ? "configured" : socialLocal ? "local" : "missing",
      wechat: wechat ? "configured" : socialLocal ? "local" : "missing",
      email: email ? "configured" : "missing",
      emailVerification: emailVerification ? "required" : "disabled",
      sessionSecret: sessionSecret ? "configured" : "missing"
    },
    aiTutor: openRouter ? "configured" : "missing",
    ready: required.length === 0,
    missing: required
  };
}

export function appOrigin(request?: Request) {
  // In local development the browser host is authoritative. This keeps redirects and
  // cookies on 127.0.0.1 when the developer opened that host instead of localhost.
  if (!isManagedEnvironment()) {
    const host = request?.headers.get("x-forwarded-host") || request?.headers.get("host");
    const protocol = request?.headers.get("x-forwarded-proto") || new URL(request?.url || "http://localhost:3000").protocol.replace(":", "");
    if (host) return `${protocol}://${host}`;
    return new URL(request?.url || "http://localhost:3000").origin;
  }
  return process.env.NEXT_PUBLIC_APP_URL?.trim() || request?.headers.get("origin") || "http://localhost:3000";
}

export function safeReturnTo(value: string | null | undefined, fallback: string) {
  if (!value || !value.startsWith("/") || /[\\\x00-\x20]/.test(value)) return fallback;
  try {
    const base = "https://return.invalid";
    const parsed = new URL(value, base);
    return parsed.origin === base ? `${parsed.pathname}${parsed.search}${parsed.hash}` : fallback;
  } catch { return fallback; }
}
