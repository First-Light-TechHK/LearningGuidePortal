import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_WORKFLOWS = [
  { file: "ci.yml", name: "Verify" },
  { file: "overlay-check.yml", name: "overlay-check" },
  { file: "forge-check.yml", name: "forge-check" },
];

const WAITING = new Set(["queued", "waiting", "pending", "requested", "in_progress"]);
const FAILED = new Set(["failure", "cancelled", "canceled", "timed_out", "startup_failure", "action_required", "skipped", "stale"]);

export function evaluateWorkflowGate(runs, sha) {
  const mine = (runs || []).filter((run) => run.headSha === sha);
  if (mine.some((run) => run.conclusion === "success")) return "pass";
  if (mine.some((run) => WAITING.has(run.status))) return "wait";
  if (mine.some((run) => FAILED.has(run.conclusion || ""))) return "fail";
  return "wait";
}

export function evaluateReleaseGate(byWorkflow, sha) {
  const results = {};
  const failed = [];
  const waiting = [];
  for (const workflow of REQUIRED_WORKFLOWS) {
    const status = evaluateWorkflowGate(byWorkflow[workflow.file] || [], sha);
    results[workflow.name] = status;
    if (status === "fail") failed.push(workflow.name);
    if (status === "wait") waiting.push(workflow.name);
  }
  if (failed.length) return { ok: false, action: "fail", failed, waiting, results };
  if (waiting.length) return { ok: false, action: "wait", failed, waiting, results };
  return { ok: true, action: "pass", failed, waiting, results };
}

function gh(endpoint) {
  return JSON.parse(execFileSync("gh", ["api", endpoint], { encoding: "utf8" }));
}

function listRuns(repo, workflow, sha) {
  const data = gh(`repos/${repo}/actions/workflows/${workflow}/runs?head_sha=${encodeURIComponent(sha)}&per_page=20`);
  return (data.workflow_runs || []).map((run) => ({
    status: run.status,
    conclusion: run.conclusion,
    headSha: run.head_sha,
  }));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForReleaseGate({
  repo,
  sha,
  timeoutMs = Number(process.env.RELEASE_GATE_TIMEOUT_MS) || 20 * 60 * 1000,
  sleepMs = Number(process.env.RELEASE_GATE_SLEEP_MS) || 20_000,
  now = Date.now,
  fetchRuns = listRuns,
} = {}) {
  if (!repo || !sha) throw new Error("release gate requires repo and sha");
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const byWorkflow = {};
    for (const workflow of REQUIRED_WORKFLOWS) {
      byWorkflow[workflow.file] = fetchRuns(repo, workflow.file, sha);
    }
    const decision = evaluateReleaseGate(byWorkflow, sha);
    console.log(JSON.stringify(decision));
    if (decision.action === "pass") return decision;
    if (decision.action === "fail") {
      throw new Error(`release gate failed: ${decision.failed.join(", ")}`);
    }
    await sleep(sleepMs);
  }
  throw new Error("timeout waiting for Verify, overlay-check and forge-check");
}

async function main() {
  await waitForReleaseGate({
    repo: process.env.GITHUB_REPOSITORY,
    sha: process.env.GITHUB_SHA,
  });
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
