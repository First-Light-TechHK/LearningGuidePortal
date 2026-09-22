import { spawnSync } from "node:child_process";
import { resolveReleaseEnvironment } from "./release/environments.mjs";
import { runLiveSmoke } from "./release/liveSmoke.mjs";
import { notifyRelease } from "./release/notify.mjs";
import { isRollbackSha, rollbackRelease } from "./release/rollback.mjs";

const environment = resolveReleaseEnvironment(process.env.RELEASE_ENV);
const sha = (process.env.RELEASE_SHA || "").trim();
const previousSha = (process.env.RELEASE_PREVIOUS_SHA || "").trim();
const origin = process.env.RELEASE_ORIGIN || environment.origin;
const adminOrigin = process.env.RELEASE_ADMIN_ORIGIN || environment.adminOrigin;
const testEmail = process.env.LIVE_TEST_EMAIL || (environment.name === "DEV" || environment.name === "SIT" ? "yongthelaoma@gmail.com" : "");
if (!environment.provisioned && !process.env.APP_RUNNER_SERVICE_ARN && !environment.serviceArn) {
  throw new Error(`${environment.name} App Runner is not provisioned; set the service ARN secret before deploying`);
}
if (!origin) throw new Error(`${environment.name} origin is not configured`);

async function smokeWithRetry() {
  let result;
  for (let attempt = 0; attempt < 12; attempt++) {
    result = await runLiveSmoke({
      origin,
      adminOrigin,
      appEnv: environment.appEnv,
      sha,
      requireDependencyChecks: environment.requireDependencyChecks,
      requireVersionMatch: environment.requireVersionMatch && isRollbackSha(sha),
      testEmail
    });
    if (result.ok) return result;
    const onlyHealth = result.failures.every((item) => item.startsWith("health") || item.startsWith("config"));
    if (!onlyHealth || attempt === 11) return result;
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
  return result;
}

const smoke = await smokeWithRetry();

if (smoke.ok && process.env.SKIP_PLAYWRIGHT !== "1") {
  const play = spawnSync("npx", ["playwright", "test", "--config=playwright.live.config.ts"], {
    stdio: "inherit",
    env: { ...process.env, LIVE_ORIGIN: origin, LIVE_ADMIN_ORIGIN: adminOrigin, LIVE_ENV: environment.appEnv, LIVE_SHA: sha, LIVE_TEST_EMAIL: testEmail, CI: "1" }
  });
  if (play.status !== 0) {
    smoke.ok = false;
    smoke.failures.push("playwright live-release failed");
  }
}

if (smoke.ok) {
  await notifyRelease({ environment: environment.name, sha, previousSha, status: "success", origin, catalogue: smoke.catalogue });
  console.log(JSON.stringify({ ok: true, environment: environment.name, sha, catalogue: smoke.catalogue }));
  process.exit(0);
}

await notifyRelease({ environment: environment.name, sha, previousSha, status: "failed", origin, failures: smoke.failures });
console.error(JSON.stringify({ ok: false, failures: smoke.failures }));

const mode = process.env.RELEASE_ROLLBACK_MODE || environment.rollbackMode;
const canRollback = process.env.SKIP_ROLLBACK !== "1" && mode && mode !== "none" && isRollbackSha(previousSha) && previousSha !== sha;
if (!canRollback) {
  console.error("No automatic rollback target; leaving the failed revision in place");
  process.exit(1);
}

try {
  const rolled = await rollbackRelease({
    serviceArn: process.env.APP_RUNNER_SERVICE_ARN || environment.serviceArn,
    branch: process.env.RELEASE_BRANCH || environment.branch,
    sha: previousSha,
    failedSha: sha,
    rollbackMode: mode
  });
  await notifyRelease({ environment: environment.name, sha: rolled.sha, previousSha: sha, status: "rolled-back", origin, operationId: rolled.operationId, failures: smoke.failures });
} catch (error) {
  await notifyRelease({ environment: environment.name, sha, previousSha, status: "rollback-failed", origin, failures: [error.message, ...smoke.failures] });
  throw error;
}
process.exit(1);
