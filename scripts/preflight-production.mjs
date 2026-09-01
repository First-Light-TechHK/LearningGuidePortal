const required = [
  "APP_ENV",
  "NEXT_PUBLIC_APP_URL",
  "DATABASE_URL",
  "DATA_S3_BUCKET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "WECHAT_APP_ID",
  "WECHAT_APP_SECRET",
  "SES_FROM_EMAIL",
  "OPENROUTER_API_KEY"
];

const missing = required.filter((name) => !process.env[name]?.trim());
const environment = (process.env.APP_ENV || "").trim().toUpperCase();
const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || "";
const paymentMode = (process.env.PAYMENT_MODE || "").trim().toLowerCase();

if (!["PPE/PROD", "PROD"].includes(environment)) missing.unshift("APP_ENV must be PPE/PROD or PROD");
if (paymentMode !== "stripe") missing.push("PAYMENT_MODE=stripe");
if (process.env.STORAGE_BACKEND === "local") missing.push("STORAGE_BACKEND must not be local in production");
if (process.env.LOCAL_SOCIAL_LOGIN === "1") missing.push("LOCAL_SOCIAL_LOGIN must not be enabled in production");
try {
  const parsed = new URL(appUrl);
  if (parsed.protocol !== "https:") missing.push("NEXT_PUBLIC_APP_URL must use HTTPS");
} catch {
  missing.push("NEXT_PUBLIC_APP_URL must be a valid HTTPS URL");
}

if (missing.length) {
  console.error(JSON.stringify({ ok: false, missing }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, environment, paymentMode: "stripe", storage: "postgresql+s3" }));
