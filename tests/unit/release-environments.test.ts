// @ts-nocheck — the release scripts are operator-only .mjs modules; the repo
// precedent for importing them from unit tests is ts-nocheck (live-smoke.test.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { releaseEnvironments, resolveReleaseEnvironment } from "../../scripts/release/environments.mjs";

test("SANDBOX is a first-class release environment, not a PROD/PPE alias", () => {
  const sandbox = resolveReleaseEnvironment("SANDBOX");
  assert.equal(sandbox.name, "SANDBOX");
  assert.equal(sandbox.appEnv, "SANDBOX");
  assert.equal(sandbox.origin, "https://sandbox.ilovelearningguide.com");
  assert.equal(sandbox.adminOrigin, "https://admin.sandbox.ilovelearningguide.com");
  assert.equal(sandbox.branch, "sandbox");
  assert.equal(sandbox.serviceName, "learning-guide-sandbox");
  // The sandbox branch only fast-forwards to the production release SHA: an
  // automatic force-push rollback must never be the default.
  assert.equal(sandbox.rollbackMode, "none");
  // Sandbox is a managed deployment: post-deploy verify must demand the DB/S3
  // dependency checks and the exact released SHA, like SIT/UAT.
  assert.equal(sandbox.requireDependencyChecks, true);
  assert.equal(sandbox.requireVersionMatch, true);
  // The App Runner service is created by ops (provisioning request P9); until its
  // ARN is supplied the gate reports "not provisioned", never "unknown environment".
  assert.equal(sandbox.provisioned, false);
  assert.equal(sandbox.serviceArn, "");
  assert.equal(releaseEnvironments.SANDBOX.serviceName, "learning-guide-sandbox");
  assert.notEqual(releaseEnvironments.SANDBOX.appEnv, releaseEnvironments.DEV.appEnv);
});

test("SANDBOX resolves from any casing and accepts SANDBOX_APP_RUNNER_SERVICE_ARN", async () => {
  const previous = process.env.SANDBOX_APP_RUNNER_SERVICE_ARN;
  const arn = "arn:aws:apprunner:ap-southeast-1:851987565851:service/learning-guide-sandbox/abc123";
  process.env.SANDBOX_APP_RUNNER_SERVICE_ARN = arn;
  try {
    // A fresh module instance reads the ARN override the same way the UAT entry does.
    const fresh = await import(`../../scripts/release/environments.mjs?arn=${Date.now()}`);
    assert.equal(fresh.resolveReleaseEnvironment(" sandbox ").serviceArn, arn);
    assert.equal(fresh.resolveReleaseEnvironment("sandbox").name, "SANDBOX");
  } finally {
    if (previous === undefined) delete process.env.SANDBOX_APP_RUNNER_SERVICE_ARN;
    else process.env.SANDBOX_APP_RUNNER_SERVICE_ARN = previous;
  }
});

test("existing release environments keep their alias and gate semantics", () => {
  assert.equal(resolveReleaseEnvironment("PPE/PROD").name, "PPE");
  assert.equal(resolveReleaseEnvironment("PROD").name, "PPE");
  assert.equal(resolveReleaseEnvironment("DEV").provisioned, true);
  assert.equal(resolveReleaseEnvironment("SIT").requireDependencyChecks, true);
  assert.equal(resolveReleaseEnvironment("UAT").serviceName, "learning-guide-uat");
  assert.throws(() => resolveReleaseEnvironment("SANDBOX2"), /Unknown release environment/);
});
