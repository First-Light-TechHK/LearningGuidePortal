import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getPool } from "./persistence/db";
import { awsRegion, dataS3Bucket, dataS3Prefix } from "./persistence/config";
import { isManagedEnvironment, runtimeConfiguration } from "./runtimeConfig";
import { studyGroupTutorKeySource } from "./tutorKeySource";

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
// - tutorKeySource: which LLM key pool the Live Session tutor actually uses:
//   `secret` (read hot from STUDY_GROUP_TUTOR_KEYS_SECRET_ID), `own`
//   (STUDY_GROUP_TUTOR_KEYS), `shared` (the site's OpenRouter key) or `none`
//   (every question answers "unavailable"). See services/tutorKeySource.ts.
// - credentialSource: `local` means LIVEKIT_LOCAL_CREDENTIALS_JSON is set on a
//   DEV deployment, where it silently shadows Secrets Manager.
// - simulated: LIVEKIT_FAKE_GATEWAY=1 is honored only on DEV; it disables
//   webhook verification and reconciliation.
// Reads the hot pool once (cached for a minute) so a fresh instance reports
// `secret` before its first question; a failed read reports the fallback.
async function tutorKeySource() {
  const source = studyGroupTutorKeySource(awsRegion());
  await source.keys().catch(() => []);
  return source.source();
}

// - liveKitProjectsSource: where the LiveKit project list comes from, as the
//   runtime picks it (modules/group-study/runtime.ts): `secret` (read hot from
//   LIVEKIT_PROJECTS_SECRET_ID), `env` (LIVEKIT_PROJECTS_JSON, fixed until the
//   next deploy) or `none`. Whether the secret currently holds a valid list is
//   the backoffice LiveKit health's answer (no projects = not read yet).
function liveKitProjectsSource(): "secret" | "env" | "none" {
  if (process.env.LIVEKIT_PROJECTS_SECRET_ID?.trim()) return "secret";
  return process.env.LIVEKIT_PROJECTS_JSON?.trim() ? "env" : "none";
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

async function studyGroupReadiness(): Promise<{
  store: "postgresql" | "file";
  configured: boolean;
  tutorKeys: "configured" | "missing" | "invalid";
  tutorKeySource: "secret" | "own" | "shared" | "none";
  credentialSource: "secrets-manager" | "local";
  simulated: boolean;
  liveKitProjectsSource: "secret" | "env" | "none";
}> {
  const explicit = (process.env.STUDY_GROUP_STORE || "").trim().toLowerCase();
  // Mirror studyGroupPersistenceBackend (modules/group-study/runtime.ts): only
  // the exact values "postgres" and "file" are honored; anything else falls
  // through to DATABASE_URL presence. Reporting a store the runtime would not
  // pick misleads operators.
  const store = explicit === "postgres" ? "postgresql" : explicit === "file" ? "file" : process.env.DATABASE_URL?.trim() ? "postgresql" : "file";
  const onDev = (process.env.APP_ENV || "DEV").trim().toUpperCase() === "DEV";
  const projectsSource = liveKitProjectsSource();
  return {
    store,
    configured: projectsSource !== "none" && Boolean(process.env.STUDY_GROUP_TOKEN_LOG_KEY?.trim()),
    tutorKeys: tutorKeyState(),
    tutorKeySource: await tutorKeySource(),
    credentialSource: onDev && Boolean(process.env.LIVEKIT_LOCAL_CREDENTIALS_JSON?.trim()) ? "local" : "secrets-manager",
    simulated: onDev && process.env.LIVEKIT_FAKE_GATEWAY === "1",
    liveKitProjectsSource: projectsSource
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
  const studyGroup = await studyGroupReadiness();
  if (!isManagedEnvironment() || !config.ready) return { ready: config.ready, checks: null, studyGroup };
  if (!cached || cached.expires < Date.now()) {
    pending ??= checkDependencies();
    try { cached = { result: await pending, expires: Date.now() + 15000 }; }
    finally { pending = undefined; }
  }
  return { ready: Object.values(cached.result).every(Boolean), checks: cached.result, studyGroup };
}
