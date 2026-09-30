import { execFileSync } from "node:child_process";
import { checkRequiredCI } from './required-ci.mjs';

const terminalStatuses = new Set(["PAUSED", "DELETED", "DELETE_FAILED", "CREATE_FAILED"]);
const failedDeployments = new Set(["FAILED", "ROLLBACK_SUCCEEDED", "ROLLBACK_FAILED"]);

function aws(service, command, payload) {
  const stdout = execFileSync("aws", [service, command, "--region", "ap-southeast-1", "--cli-input-json", JSON.stringify(payload), "--output", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return stdout.trim() ? JSON.parse(stdout) : {};
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function buildService(serviceArn) {
  if (!serviceArn) throw new Error("APP_RUNNER_SERVICE_ARN is required");
  const deadline = Date.now() + 25 * 60 * 1000;
  let operationId = "";
  while (Date.now() < deadline) {
    const status = aws("apprunner", "describe-service", { ServiceArn: serviceArn }).Service?.Status || "UNKNOWN";
    console.log(`App Runner Status=${status}`);
    if (terminalStatuses.has(status)) throw new Error(`App Runner service is not deployable (${status}).`);
    if (status !== "RUNNING") {
      await sleep(15000);
      continue;
    }
    try {
      const started = aws("apprunner", "start-deployment", { ServiceArn: serviceArn });
      operationId = started.OperationId || "";
      if (!operationId) throw new Error("start-deployment returned no OperationId.");
      console.log(`start-deployment accepted: ${operationId}`);
      break;
    } catch (error) {
      const text = `${error.stderr || ""}\n${error.message || error}`;
      if (/not in RUNNING|isn't in RUNNING|InvalidRequestException/i.test(text)) {
        await sleep(15000);
        continue;
      }
      throw error;
    }
  }
  if (!operationId) throw new Error("Timed out waiting for App Runner to accept the source build.");

  const buildDeadline = Date.now() + 25 * 60 * 1000;
  while (Date.now() < buildDeadline) {
    const operations = aws("apprunner", "list-operations", { ServiceArn: serviceArn, MaxResults: 5 }).OperationSummaryList || [];
    const operation = operations.find((item) => item.Id === operationId);
    const status = operation?.Status || "PENDING";
    console.log(`source build ${operationId} Status=${status}`);
    if (status === "SUCCEEDED") return operationId;
    if (failedDeployments.has(status)) throw new Error(`App Runner source build ${operationId} ended as ${status}.`);
    await sleep(15000);
  }
  throw new Error(`Timed out waiting for source build ${operationId}.`);
}

if (process.argv[1]?.endsWith("build-branch.mjs")) {
  const service = aws('apprunner', 'describe-service', { ServiceArn: process.env.APP_RUNNER_SERVICE_ARN }).Service;
  if (service.ServiceName === 'learning-guide-uat') throw new Error('Use scripts/release-uat.mjs; raw UAT builds bypass acceptance');
  checkRequiredCI({ sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), branch: process.env.GITHUB_REF_NAME || execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim() });
  await buildService(process.env.APP_RUNNER_SERVICE_ARN);
}
