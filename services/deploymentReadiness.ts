import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getPool } from "./persistence/db";
import { awsRegion, dataS3Bucket, dataS3Prefix } from "./persistence/config";
import { isManagedEnvironment, runtimeConfiguration } from "./runtimeConfig";

let cached: { expires: number; result: Awaited<ReturnType<typeof checkDependencies>> } | undefined;
let pending: Promise<Awaited<ReturnType<typeof checkDependencies>>> | undefined;

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
  if (!isManagedEnvironment() || !config.ready) return { ready: config.ready, checks: null };
  if (!cached || cached.expires < Date.now()) {
    pending ??= checkDependencies();
    try { cached = { result: await pending, expires: Date.now() + 15000 }; }
    finally { pending = undefined; }
  }
  return { ready: Object.values(cached.result).every(Boolean), checks: cached.result };
}
