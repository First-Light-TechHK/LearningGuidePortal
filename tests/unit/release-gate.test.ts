import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateReleaseGate, evaluateWorkflowGate, waitForReleaseGate } from "../../scripts/release-gate.mjs";

const sha = "6d4028bc6c4b90fd0435f41883bb54318c94ebc6";
const run = (status: string, conclusion: string | null, headSha = sha) => ({ status, conclusion, headSha });

test("a failed Verify on this SHA cannot pass the release gate", () => {
  assert.equal(evaluateWorkflowGate([run("completed", "failure")], sha), "fail");
});

test("in-progress Verify waits; a different SHA does not count as green", () => {
  assert.equal(evaluateWorkflowGate([run("in_progress", null)], sha), "wait");
  assert.equal(evaluateWorkflowGate([run("completed", "success", "deadbeef")], sha), "wait");
});

test("CD stays blocked until Verify, overlay-check and forge-check are all green", () => {
  const waiting = evaluateReleaseGate({
    "ci.yml": [run("completed", "success")],
    "overlay-check.yml": [run("in_progress", null)],
    "forge-check.yml": [run("completed", "success")],
  }, sha);
  assert.equal(waiting.action, "wait");
  assert.deepEqual(waiting.waiting, ["overlay-check"]);

  const blocked = evaluateReleaseGate({
    "ci.yml": [run("completed", "failure")],
    "overlay-check.yml": [run("completed", "success")],
    "forge-check.yml": [run("completed", "success")],
  }, sha);
  assert.equal(blocked.action, "fail");
  assert.deepEqual(blocked.failed, ["Verify"]);

  const ready = evaluateReleaseGate({
    "ci.yml": [run("completed", "success")],
    "overlay-check.yml": [run("completed", "success")],
    "forge-check.yml": [run("completed", "success")],
  }, sha);
  assert.equal(ready.action, "pass");
  assert.equal(ready.ok, true);
});

test("waitForReleaseGate never calls AWS and fails a red Verify without waiting out the timeout", async () => {
  await assert.rejects(
    waitForReleaseGate({
      repo: "First-Light-TechHK/LearningGuidePortal",
      sha,
      timeoutMs: 60_000,
      sleepMs: 1,
      fetchRuns: (repo, workflow) => {
        assert.equal(repo, "First-Light-TechHK/LearningGuidePortal");
        if (workflow === "ci.yml") return [run("completed", "failure")];
        return [run("completed", "success")];
      },
    }),
    /release gate failed: Verify/,
  );
});

test("Deploy DEV and SIT run the release gate before AWS credentials", async () => {
  const { readFileSync } = await import("node:fs");
  const dev = readFileSync(".github/workflows/dev-deploy.yml", "utf8");
  const sit = readFileSync(".github/workflows/sit-deploy.yml", "utf8");
  for (const source of [dev, sit]) {
    const gateAt = source.indexOf("scripts/release-gate.mjs");
    const awsAt = source.indexOf("aws-actions/configure-aws-credentials");
    assert.ok(gateAt >= 0, "release-gate.mjs must be invoked");
    assert.ok(awsAt > gateAt, "release gate must run before AWS credentials");
  }
  const awsAt = dev.indexOf("aws-actions/configure-aws-credentials");
  const waitAt = dev.indexOf("scripts/release-dev.mjs");
  assert.ok(waitAt > awsAt, "Deploy DEV must wait for the App Runner Operation after AWS credentials");
  assert.equal(dev.includes("2>/dev/null"), false, "Deploy DEV must not swallow list-operations errors");
});
