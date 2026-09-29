import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AWS_ACCOUNT, AWS_REGION } from "./environments.mjs";

const SHA = /^[0-9a-f]{40}$/i;

function aws(service, operation, input = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "lg-rollback-"));
  try {
    const file = path.join(dir, "input.json");
    writeFileSync(file, JSON.stringify(input), { mode: 0o600 });
    return JSON.parse(execFileSync("aws", [service, operation, "--region", AWS_REGION, "--output", "json", "--cli-input-json", `file://${file}`], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }) || "{}");
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

export function isRollbackSha(value) {
  return SHA.test(String(value || ""));
}

function gitPushForce(sha, branch) {
  execFileSync("git", ["push", "--force", "origin", `${sha}:${branch}`], { stdio: "inherit" });
}

function gitRevert(sha, branch) {
  const message = execFileSync("git", ["log", "-1", "--format=%s", sha], { encoding: "utf8" }).trim();
  if (/^release-rollback:|^Revert "/.test(message)) throw new Error("Refusing to roll back a rollback commit");
  execFileSync("git", ["fetch", "origin", branch], { stdio: "inherit" });
  execFileSync("git", ["checkout", "-B", branch, `origin/${branch}`], { stdio: "inherit" });
  execFileSync("git", ["-c", "user.email=github-actions[bot]@users.noreply.github.com", "-c", "user.name=github-actions[bot]", "revert", "--no-edit", sha], { stdio: "inherit" });
  execFileSync("git", ["push", "origin", branch], { stdio: "inherit" });
}

async function waitForService(serviceArn, operationId) {
  for (let i = 0; i < 120; i++) {
    await new Promise((resolve) => setTimeout(resolve, 20000));
    if (operationId) {
      const operation = aws("apprunner", "list-operations", { ServiceArn: serviceArn }).OperationSummaryList.find((item) => item.Id === operationId);
      if (operation?.Status === "SUCCEEDED") return;
      if (operation && /FAILED|ROLLBACK/.test(operation.Status)) throw new Error(`Rollback deployment ${operation.Status}`);
    } else {
      const status = aws("apprunner", "describe-service", { ServiceArn: serviceArn }).Service.Status;
      if (status === "RUNNING") return;
    }
  }
  throw new Error("Timed out waiting for rollback deployment");
}

export async function rollbackRelease({ serviceArn, branch, sha, failedSha, rollbackMode }) {
  if (!isRollbackSha(sha)) throw new Error("No previous git SHA available for rollback");
  if (aws("sts", "get-caller-identity").Account !== AWS_ACCOUNT) throw new Error("Wrong AWS account");
  let restored = sha;
  if (rollbackMode === "force-branch") gitPushForce(sha, branch);
  else if (rollbackMode === "revert-commit") {
    if (!isRollbackSha(failedSha)) throw new Error("No failed git SHA available to revert");
    gitRevert(failedSha, branch);
    restored = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } else throw new Error(`Unsupported rollback mode: ${rollbackMode}`);

  const current = aws("apprunner", "describe-service", { ServiceArn: serviceArn }).Service;
  const source = current.SourceConfiguration;
  if (source.CodeRepository) {
    source.CodeRepository.SourceCodeVersion = { Type: "BRANCH", Value: branch };
    source.CodeRepository.CodeConfiguration.CodeConfigurationValues.RuntimeEnvironmentVariables.APP_VERSION = restored;
  } else if (source.ImageRepository) {
    source.ImageRepository.ImageConfiguration.RuntimeEnvironmentVariables.APP_VERSION = restored;
  }
  const update = aws("apprunner", "update-service", { ServiceArn: serviceArn, SourceConfiguration: source });
  await waitForService(serviceArn, update.OperationId);
  const started = aws("apprunner", "start-deployment", { ServiceArn: serviceArn });
  if (!started.OperationId) throw new Error("start-deployment returned no OperationId");
  await waitForService(serviceArn, started.OperationId);
  return { operationId: started.OperationId, sha: restored, branch };
}
