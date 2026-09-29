import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const arn = process.env.APP_RUNNER_SERVICE_ARN;
const sha = process.env.APP_VERSION;
if (!arn || !sha) throw new Error("APP_RUNNER_SERVICE_ARN and APP_VERSION are required");

function aws(service, operation, input = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "lg-stamp-"));
  try {
    const file = path.join(dir, "input.json");
    writeFileSync(file, JSON.stringify(input), { mode: 0o600 });
    return JSON.parse(execFileSync("aws", [service, operation, "--region", "ap-southeast-1", "--output", "json", "--cli-input-json", `file://${file}`], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }) || "{}");
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const current = aws("apprunner", "describe-service", { ServiceArn: arn }).Service;
const previous = current.SourceConfiguration.CodeRepository?.CodeConfiguration?.CodeConfigurationValues?.RuntimeEnvironmentVariables?.APP_VERSION
  || current.SourceConfiguration.ImageRepository?.ImageConfiguration?.RuntimeEnvironmentVariables?.APP_VERSION
  || "";
const source = current.SourceConfiguration;
if (source.CodeRepository) source.CodeRepository.CodeConfiguration.CodeConfigurationValues.RuntimeEnvironmentVariables.APP_VERSION = sha;
else source.ImageRepository.ImageConfiguration.RuntimeEnvironmentVariables.APP_VERSION = sha;
const update = aws("apprunner", "update-service", { ServiceArn: arn, SourceConfiguration: source });
console.log(JSON.stringify({ previousSha: previous, sha, operation: update.OperationId }));
let complete = false;
for (let i = 0; i < 120; i++) {
  await new Promise((resolve) => setTimeout(resolve, 20000));
  const operation = aws("apprunner", "list-operations", { ServiceArn: arn }).OperationSummaryList.find((item) => item.Id === update.OperationId);
  if (operation?.Status === "SUCCEEDED") { complete = true; break; }
  if (operation && /FAILED|ROLLBACK/.test(operation.Status)) throw new Error(`Stamp deploy ${operation.Status}`);
}
if (!complete) throw new Error("Timed out waiting to stamp APP_VERSION");
