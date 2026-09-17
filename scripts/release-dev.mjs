import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findOperation, formatOperationId, interpretDeployProgress, isBusyService } from "./apprunner-operation.mjs";

const serviceArn = process.env.APP_RUNNER_SERVICE_ARN;
const region = process.env.AWS_REGION || "ap-southeast-1";
const expectedAccount = process.env.AWS_ACCOUNT_ID || "851987565851";
const sleepMs = Number(process.env.DEV_DEPLOY_SLEEP_MS || 20_000);
const acceptTimeoutMs = Number(process.env.DEV_DEPLOY_ACCEPT_TIMEOUT_MS || 25 * 60 * 1000);
const operationTimeoutMs = Number(process.env.DEV_DEPLOY_OPERATION_TIMEOUT_MS || 30 * 60 * 1000);
const healthTimeoutMs = Number(process.env.DEV_DEPLOY_HEALTH_TIMEOUT_MS || 5 * 60 * 1000);

function aws(service, operation, input = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "lg-dev-release-"));
  try {
    const file = path.join(dir, "input.json");
    writeFileSync(file, JSON.stringify(input), { mode: 0o600 });
    return JSON.parse(execFileSync(
      "aws",
      [service, operation, "--region", region, "--output", "json", "--cli-input-json", `file://${file}`],
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    ));
  } catch (error) {
    const detail = [error.stderr, error.stdout, error.message].filter(Boolean).join("\n").trim();
    throw new Error(detail || `${service} ${operation} failed`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeService() {
  return aws("apprunner", "describe-service", { ServiceArn: serviceArn }).Service;
}

function listAllOperations() {
  const items = [];
  let NextToken;
  do {
    const page = aws("apprunner", "list-operations", {
      ServiceArn: serviceArn,
      MaxResults: 20,
      ...(NextToken ? { NextToken } : {}),
    });
    items.push(...(page.OperationSummaryList || []));
    NextToken = page.NextToken;
  } while (NextToken);
  return items;
}

async function waitUntilRunning(deadline) {
  while (Date.now() < deadline) {
    const status = describeService().Status;
    console.log(`App Runner Status=${status || "unknown"}`);
    if (status === "RUNNING") return;
    if (["PAUSED", "DELETED", "DELETE_FAILED", "CREATE_FAILED"].includes(status)) {
      throw new Error(`service is not deployable (Status=${status})`);
    }
    console.log(`not RUNNING (OPERATION in progress or equivalent); queue/wait ${sleepMs / 1000}s`);
    await sleep(sleepMs);
  }
  throw new Error("timeout: waited for Status=RUNNING");
}

async function startDeployment(deadline) {
  while (Date.now() < deadline) {
    await waitUntilRunning(deadline);
    try {
      const out = aws("apprunner", "start-deployment", { ServiceArn: serviceArn });
      const operationId = out.OperationId;
      if (!operationId) throw new Error("start-deployment returned no OperationId");
      console.log(JSON.stringify(out));
      console.log(`start-deployment accepted: OperationId=${operationId} listedAs=${formatOperationId(operationId)}`);
      return operationId;
    } catch (error) {
      const message = String(error.message || error);
      console.log(message);
      if (/InvalidRequestException|isn.?t in RUNNING|not in RUNNING/i.test(message)) {
        console.log("start-deployment collided (service not RUNNING); wait and retry, do not fail");
        await sleep(sleepMs);
        continue;
      }
      throw error;
    }
  }
  throw new Error("timeout: waited to accept start-deployment");
}

async function waitForOperation(operationId, deadline) {
  let listedOnce = false;
  let seenBusy = false;
  while (Date.now() < deadline) {
    let operation = null;
    let listError = "";
    try {
      const operations = listAllOperations();
      operation = findOperation(operations, operationId);
      if (!operation && !listedOnce) {
        console.log(JSON.stringify({
          note: "operation id not yet visible on list-operations; matching hyphenless and UUID forms",
          wanted: formatOperationId(operationId),
          raw: operationId,
          seen: operations.slice(0, 5).map((item) => ({ id: item.Id, status: item.Status, type: item.Type })),
        }));
        listedOnce = true;
      }
    } catch (error) {
      listError = String(error.message || error);
      console.log(`list-operations error (not swallowed): ${listError}`);
    }
    const serviceStatus = describeService().Status;
    if (isBusyService(serviceStatus) || operation?.Status === "IN_PROGRESS" || operation?.Status === "PENDING") {
      seenBusy = true;
    }
    const operationStatus = operation?.Status || "";
    console.log(`App Runner OperationId=${operationId} Status=${operationStatus || "unknown"} ServiceStatus=${serviceStatus || "unknown"}`);
    const decision = interpretDeployProgress({ operationStatus, serviceStatus, seenBusy, listError });
    if (decision.action === "success") {
      console.log(decision.reason);
      return;
    }
    if (decision.action === "fail") throw new Error(decision.reason);
    await sleep(sleepMs);
  }
  throw new Error("timeout: deployment operation did not succeed");
}

async function waitForHealth(deadline) {
  const url = `https://${describeService().ServiceUrl}/api/health`;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      const health = await response.json();
      if (response.ok && health.ready) {
        console.log(JSON.stringify(health));
        console.log("DEV deployment completed and health check passed");
        return;
      }
      console.log(`DEV health check not ready (${response.status}); retrying in ${sleepMs / 1000}s`);
    } catch (error) {
      console.log(`DEV health check not ready: ${error instanceof Error ? error.message : error}`);
    }
    await sleep(sleepMs);
  }
  throw new Error(`DEV health check did not pass: ${url}`);
}

export async function releaseDev({ now = Date.now, start = startDeployment, waitOperation = waitForOperation, waitHealth = waitForHealth } = {}) {
  if (!serviceArn) throw new Error("APP_RUNNER_SERVICE_ARN is required");
  if (aws("sts", "get-caller-identity").Account !== expectedAccount) throw new Error("Wrong AWS account");
  console.log("DEV target: learning-guide-portal (www + admin)");
  const operationId = await start(now() + acceptTimeoutMs);
  await waitOperation(operationId, now() + operationTimeoutMs);
  await waitHealth(now() + healthTimeoutMs);
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  releaseDev().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
