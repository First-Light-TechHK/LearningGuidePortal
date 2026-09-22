import { execFileSync } from "node:child_process";

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
  await buildService(process.env.APP_RUNNER_SERVICE_ARN);
}
