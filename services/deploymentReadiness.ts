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
function studyGroupReadiness(): { store: "postgresql" | "file"; configured: boolean } {
  const explicit = (process.env.STUDY_GROUP_STORE || "").trim().toLowerCase();
  const store = explicit === "file" || explicit === "filesystem" || !process.env.DATABASE_URL?.trim()
    ? "file"
    : "postgresql";
  return {
    store,
    configured: Boolean(process.env.LIVEKIT_PROJECTS_JSON?.trim() && process.env.STUDY_GROUP_TOKEN_LOG_KEY?.trim())
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
