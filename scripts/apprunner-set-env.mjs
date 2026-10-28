// Merge the DEV AI Tutor integration variables into the learning-guide-portal
// App Runner service, then start a deployment only when something changed.
//
// Because the service is source-deployed (ConfigurationSource: "API"), the
// values live in App Runner, not in the repository. This script is additive:
// it touches only the keys listed below and preserves every other variable an
// operator already set. It never prints secret values — only ARNs and key names.
//
// Usage:
//   APP_RUNNER_SERVICE_ARN=... \
//   KS_TUTOR_BASE_URL=https://... \
//   node scripts/apprunner-set-env.mjs [--dry-run]
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  assertPublicHttpsUrl,
  assertSecretArn,
  mergeRuntimeConfiguration,
} from "./apprunner-env.mjs";

const arn = process.env.APP_RUNNER_SERVICE_ARN;
if (!arn) throw new Error("APP_RUNNER_SERVICE_ARN is required");
const dryRun = process.argv.includes("--dry-run");

function aws(service, operation, input = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "lg-env-"));
  try {
    const file = path.join(dir, "input.json");
    writeFileSync(file, JSON.stringify(input), { mode: 0o600 });
    return JSON.parse(
      execFileSync("aws", [service, operation, "--region", "ap-southeast-1", "--output", "json", "--cli-input-json", `file://${file}`], {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      }) || "{}",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// AI Tutor now runs in KnowledgeSystem; Portal proxies to its learner API.
const desired = {
  variables: {
    KS_TUTOR_BASE_URL: assertPublicHttpsUrl(process.env.KS_TUTOR_BASE_URL),
    ...(process.env.KS_TUTOR_TIMEOUT_MS ? { KS_TUTOR_TIMEOUT_MS: process.env.KS_TUTOR_TIMEOUT_MS } : {}),
  },
  // Only set when KS runs with AUTH_ENABLED=true; the value must be the secret's ARN.
  secrets: process.env.KS_TUTOR_API_KEY_SECRET_ARN
    ? { KS_TUTOR_API_KEY: assertSecretArn(process.env.KS_TUTOR_API_KEY_SECRET_ARN, "KS_TUTOR_API_KEY_SECRET_ARN") }
    : {},
};

const current = aws("apprunner", "describe-service", { ServiceArn: arn }).Service;
const { sourceConfiguration, changed, applied } = mergeRuntimeConfiguration(
  current.SourceConfiguration,
  desired,
);

console.log(
  JSON.stringify({
    service: "learning-guide-portal",
    desired: { variables: applied.variables, secrets: applied.secrets },
    changed,
    dryRun,
  }),
);

if (!changed) {
  console.log("No runtime configuration change; skipping deployment.");
  process.exit(0);
}
if (dryRun) {
  console.log("Dry run: update-service skipped.");
  process.exit(0);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// UpdateService requires a settled service; wait out any in-flight deployment.
for (let i = 0; i < 80; i += 1) {
  const status = aws("apprunner", "describe-service", { ServiceArn: arn }).Service.Status;
  if (status === "RUNNING") break;
  if (["PAUSED", "DELETED", "DELETE_FAILED", "CREATE_FAILED"].includes(status)) {
    throw new Error(`Service is not deployable (Status=${status})`);
  }
  if (i === 79) throw new Error(`Timed out waiting for Status=RUNNING (last ${status})`);
  await sleep(15000);
}

const update = aws("apprunner", "update-service", {
  ServiceArn: arn,
  SourceConfiguration: sourceConfiguration,
});
console.log(JSON.stringify({ operation: update.OperationId }));

let complete = false;
for (let i = 0; i < 120; i += 1) {
  await sleep(20000);
  const operation = aws("apprunner", "list-operations", { ServiceArn: arn }).OperationSummaryList.find(
    (item) => item.Id === update.OperationId,
  );
  if (operation?.Status === "SUCCEEDED") {
    complete = true;
    break;
  }
  if (operation && /FAILED|ROLLBACK/.test(operation.Status)) {
    throw new Error(`Configuration update ${operation.Status}`);
  }
}
if (!complete) throw new Error("Timed out waiting for the configuration update");