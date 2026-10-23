import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getPool } from "./persistence/db";
import { awsRegion, dataS3Bucket, dataS3Prefix } from "./persistence/config";
import { isManagedEnvironment, runtimeConfiguration } from "./runtimeConfig";

let cached: { expires: number; result: Awaited<ReturnType<typeof checkDependencies>> } | undefined;
let pending: Promise<Awaited<ReturnType<typeof checkDependencies>>> | undefined;

// Redacted Study Group readiness (slice-3 preflight entry): the store kind and
// whether the LiveKit configuration is present. Values are never echoed — the
// file store is reported whenever it is selected explicitly or would be
// selected because no DATABASE_URL exists.
//
// The extra fields answer "is the deployed environment wired the honest way?"
// without AWS access:
// - tutorSource: the Live Session Tutor is KnowledgeSystem's (2026-10-23), so
//   `ks` means KS_TUTOR_BASE_URL is present and room questions are forwarded;
//   `none` means every room question answers "unavailable". Prompt, model and
//   LLM keys are configured in KS, never here.
// - credentialSource: `local` means LIVEKIT_LOCAL_CREDENTIALS_JSON is set on a
//   DEV deployment, where it silently shadows Secrets Manager.
// - simulated: LIVEKIT_FAKE_GATEWAY=1 is honored only on DEV; it disables
//   webhook verification and reconciliation.
function tutorSource(): "ks" | "none" {
  return process.env.KS_TUTOR_BASE_URL?.trim() ? "ks" : "none";
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

async function studyGroupReadiness(): Promise<{
  store: "postgresql" | "file";
  configured: boolean;
  tutorSource: "ks" | "none";
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
    tutorSource: tutorSource(),
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
