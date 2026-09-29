import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { RELEASE_SNS_TOPIC, AWS_REGION } from "./environments.mjs";

function awsCliAvailable() {
  try {
    execFileSync("aws", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function formatReleaseMessage({ environment, sha, previousSha, status, origin, failures, operationId }) {
  const lines = [
    `Learning Guide ${environment} release ${status}`,
    `sha=${sha || "(unknown)"}`,
    `previous=${previousSha || "(none)"}`,
    `origin=${origin || "(none)"}`
  ];
  if (operationId) lines.push(`operation=${operationId}`);
  if (failures?.length) lines.push(`failures=${failures.join(" | ")}`);
  return lines.join("\n");
}

export async function notifyRelease(event) {
  const message = formatReleaseMessage(event);
  const subject = `LG ${event.environment} ${event.status}`.slice(0, 100);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## ${subject}\n\n\`\`\`\n${message}\n\`\`\`\n`);
  }
  console.log(message);
  const topic = process.env.RELEASE_SNS_TOPIC_ARN || RELEASE_SNS_TOPIC;
  if (!topic || process.env.SKIP_SNS === "1" || !awsCliAvailable()) return { sns: "skipped", message };
  try {
    execFileSync("aws", [
      "sns", "publish",
      "--region", AWS_REGION,
      "--topic-arn", topic,
      "--subject", subject,
      "--message", message
    ], { stdio: ["ignore", "pipe", "pipe"] });
    return { sns: "published", message };
  } catch (error) {
    console.log("SNS publish skipped:", error.stderr?.toString()?.slice(0, 200) || error.message);
    return { sns: "failed", message };
  }
}
