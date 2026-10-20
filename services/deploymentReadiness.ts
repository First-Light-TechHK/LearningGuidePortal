import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getPool } from "./persistence/db";
import { awsRegion, dataS3Bucket, dataS3Prefix } from "./persistence/config";
import { isManagedEnvironment, runtimeConfiguration } from "./runtimeConfig";
import { readTutorKeys, studyGroupTutorKeys } from "@/modules/group-study/tutorAnswer";

let cached: { expires: number; result: Awaited<ReturnType<typeof checkDependencies>> } | undefined;
let pending: Promise<Awaited<ReturnType<typeof checkDependencies>>> | undefined;

// Redacted Study Group readiness (slice-3 preflight entry): the store kind and
// whether the LiveKit configuration is present. Values are never echoed — the
// file store is reported whenever it is selected explicitly or would be
// selected because no DATABASE_URL exists.
//
// The extra fields answer "is the deployed environment wired the honest way?"
// without AWS access:
// - tutorKeys: mirrors the acceptance rule of readTutorKeys
//   (modules/group-study/tutorAnswer.ts) so readiness never claims a pool the
//   runtime would ignore; `invalid` means the variable exists but yields no
//   usable key.
// - tutorKeySource: which pool the Live Session tutor actually uses: `own`
//   (STUDY_GROUP_TUTOR_KEYS), `shared` (the site's OpenRouter key, see
//   studyGroupTutorKeys) or `none` (every question answers "unavailable").
// - credentialSource: `local` means LIVEKIT_LOCAL_CREDENTIALS_JSON is set on a
//   DEV deployment, where it silently shadows Secrets Manager.
// - simulated: LIVEKIT_FAKE_GATEWAY=1 is honored only on DEV; it disables
//   webhook verification and reconciliation.
function tutorKeySource(): "own" | "shared" | "none" {
  if (readTutorKeys(process.env.STUDY_GROUP_TUTOR_KEYS).length > 0) return "own";
  return studyGroupTutorKeys(process.env).length > 0 ? "shared" : "none";
}

function tutorKeyState(): "configured" | "missing" | "invalid" {
  const raw = process.env.STUDY_GROUP_TUTOR_KEYS?.trim();
  if (!raw) return "missing";
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return "invalid";
    const usable = parsed.some((item) => {
      if (!item || typeof item !== "object") return false;
      const record = item as { id?: unknown; secret?: unknown };
      return typeof record.id === "string" && record.id.trim() !== "" && typeof record.secret === "string" && record.secret.trim() !== "";
    });
    return usable ? "configured" : "invalid";
  } catch {
    return "invalid";
  }
}

function studyGroupReadiness(): {
  store: "postgresql" | "file";
  configured: boolean;
  tutorKeys: "configured" | "missing" | "invalid";
  tutorKeySource: "own" | "shared" | "none";
  credentialSource: "secrets-manager" | "local";
  simulated: boolean;
} {
  const explicit = (process.env.STUDY_GROUP_STORE || "").trim().toLowerCase();
  // Mirror studyGroupPersistenceBackend (modules/group-study/runtime.ts): only
  // the exact values "postgres" and "file" are honored; anything else falls
  // through to DATABASE_URL presence. Reporting a store the runtime would not
  // pick misleads operators.
  const store = explicit === "postgres" ? "postgresql" : explicit === "file" ? "file" : process.env.DATABASE_URL?.trim() ? "postgresql" : "file";
  const onDev = (process.env.APP_ENV || "DEV").trim().toUpperCase() === "DEV";
  return {
    store,
    configured: Boolean(process.env.LIVEKIT_PROJECTS_JSON?.trim() && process.env.STUDY_GROUP_TOKEN_LOG_KEY?.trim()),
    tutorKeys: tutorKeyState(),
    tutorKeySource: tutorKeySource(),
    credentialSource: onDev && Boolean(process.env.LIVEKIT_LOCAL_CREDENTIALS_JSON?.trim()) ? "local" : "secrets-manager",
    simulated: onDev && process.env.LIVEKIT_FAKE_GATEWAY === "1"
  };
}

async function checkDependencies() {
  const checks = { database: false, paymentMigration: false, storage: false };
  try {
    const result = await getPool().query("SELECT to_regclass('public.app_files') IS NOT NULL AS files, to_regclass('public.product_payment_keys') IS NOT NULL AS payment");
    checks.database = result.rows[0].files;
    checks.paymentMigration = result.rows[0].payment;
  } catch { /* Return no connection details to the public health endpoint. */ }
  try {
    await new S3Client({ region: awsRegion() }).send(new HeadObjectCommand({
      Bucket: dataS3Bucket(), Key: `${dataS3Prefix()}/.deployment-ready`
    }), { abortSignal: AbortSignal.timeout(5000) });
    checks.storage = true;
  } catch { /* Missing IAM permissions or marker must fail readiness. */ }
  return checks;
}

export async function deploymentReadiness() {
  const config = runtimeConfiguration();
  const studyGroup = studyGroupReadiness();
  if (!isManagedEnvironment() || !config.ready) return { ready: config.ready, checks: null, studyGroup };
  if (!cached || cached.expires < Date.now()) {
    pending ??= checkDependencies();
    try { cached = { result: await pending, expires: Date.now() + 15000 }; }
    finally { pending = undefined; }
  }
  return { ready: Object.values(cached.result).every(Boolean), checks: cached.result, studyGroup };
}
