const required = [
  "APP_ENV",
  "NEXT_PUBLIC_APP_URL",
  "DATABASE_URL",
  "DATA_S3_BUCKET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "SESSION_SECRET",
  "WECHAT_APP_ID",
  "WECHAT_APP_SECRET",
  "SES_FROM_EMAIL",
  "OPENROUTER_API_KEY",
  "LIVEKIT_PROJECTS_JSON",
  "STUDY_GROUP_TOKEN_LOG_KEY"
];

const missing = required.filter((name) => !process.env[name]?.trim());
const environment = (process.env.APP_ENV || "").trim().toUpperCase();
const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || "";
const paymentMode = (process.env.PAYMENT_MODE || "").trim().toLowerCase();

if (process.env.SESSION_SECRET?.trim() && process.env.SESSION_SECRET.trim().length < 32) missing.push("SESSION_SECRET must contain at least 32 characters");

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

// Study Group release gate. Diagnostics never echo env values — only the rule
// violation — and a failing entry blocks promotion exactly like the checks above.
if ((process.env.STUDY_GROUP_STORE || "").trim().toLowerCase() === "file") {
  missing.push("STUDY_GROUP_STORE must not be the file store in production");
}
if (process.env.LIVEKIT_PROJECTS_JSON?.trim()) {
  let hasActiveProject = false;
  try {
    const projects = JSON.parse(process.env.LIVEKIT_PROJECTS_JSON);
    hasActiveProject = Array.isArray(projects)
      && projects.some((project) => project !== null && typeof project === "object" && project.state === "active");
  } catch {
    hasActiveProject = false;
  }
  if (!hasActiveProject) missing.push("LIVEKIT_PROJECTS_JSON must be a JSON array with at least one active project");
}
const tokenLogKey = process.env.STUDY_GROUP_TOKEN_LOG_KEY?.trim();
if (tokenLogKey && Buffer.from(tokenLogKey, "base64").length !== 32) {
  missing.push("STUDY_GROUP_TOKEN_LOG_KEY must be a 32-byte base64 value");
}

if (missing.length) {
  console.error(JSON.stringify({ ok: false, missing }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, environment, paymentMode: "stripe", storage: "postgresql+s3" }));
