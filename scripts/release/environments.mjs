export const AWS_ACCOUNT = "851987565851";
export const AWS_REGION = "ap-southeast-1";
export const RELEASE_SNS_TOPIC = "arn:aws:sns:ap-southeast-1:851987565851:learning-guide-sit-alerts";

export const releaseEnvironments = {
  DEV: {
    appEnv: "DEV",
    origin: "https://www.ilovelearningguide.com",
    adminOrigin: "https://admin.ilovelearningguide.com",
    branch: "dev",
    serviceName: "learning-guide-portal",
    serviceArn: "arn:aws:apprunner:ap-southeast-1:851987565851:service/learning-guide-portal/73f7ec76f1884c5f936544916a2607ad",
    rollbackMode: "force-branch",
    requireDependencyChecks: false,
    requireVersionMatch: false,
    provisioned: true
  },
  SIT: {
    appEnv: "SIT",
    origin: "https://sit.ilovelearningguide.com",
    adminOrigin: "https://admin.sit.ilovelearningguide.com",
    branch: "sit",
    serviceName: "learning-guide-sit",
    serviceArn: "arn:aws:apprunner:ap-southeast-1:851987565851:service/learning-guide-sit/5b9b982e873e4f08ad2f5a50f67d67d0",
    rollbackMode: "force-branch",
    requireDependencyChecks: true,
    requireVersionMatch: true,
    provisioned: true
  },
  UAT: {
    appEnv: "UAT",
    origin: "https://uat.ilovelearningguide.com",
    // UAT's Admin host is not provisioned behind a hostname: admin.uat currently
    // resolves to the Portal distribution. Until that record exists, allow the
    // real Admin UAT App Runner URL (or an empty value to skip the Admin probes,
    // which liveSmoke treats as "no Admin in this environment").
    adminOrigin: process.env.UAT_ADMIN_ORIGIN ?? "https://admin.uat.ilovelearningguide.com",
    branch: "uat",
    serviceName: "learning-guide-uat",
    serviceArn: process.env.UAT_APP_RUNNER_SERVICE_ARN || "arn:aws:apprunner:ap-southeast-1:851987565851:service/learning-guide-uat/ad3b8483fecc45d9a3b0bb3d2aad7783",
    rollbackMode: "force-branch",
    requireDependencyChecks: true,
    requireVersionMatch: true,
    provisioned: true
  },
  // Sandbox is its own release environment (PRD v2.0 §3.1, owner 2026-11-14):
  // an isolated deployment of the same code as the UAT/Production baseline.
  // It is a real key, never an alias of PROD/PPE. Ops creates the App Runner
  // service (provisioning request P9); until its ARN is provided the deploy
  // gate reports "not provisioned" instead of "unknown environment".
  SANDBOX: {
    appEnv: "SANDBOX",
    origin: "https://sandbox.ilovelearningguide.com",
    adminOrigin: "https://admin.sandbox.ilovelearningguide.com",
    branch: "sandbox",
    serviceName: "learning-guide-sandbox",
    serviceArn: process.env.SANDBOX_APP_RUNNER_SERVICE_ARN || "",
    // The sandbox branch only ever fast-forwards to the latest production release
    // SHA (LearningGuideSandbox contract), so an automatic force-push rollback is
    // forbidden. A failed verify stays red for a human; RELEASE_ROLLBACK_MODE can
    // still override per run.
    rollbackMode: "none",
    requireDependencyChecks: true,
    requireVersionMatch: true,
    provisioned: false
  },
  PPE: {
    appEnv: "PPE/PROD",
    origin: process.env.PPE_ORIGIN || "",
    adminOrigin: process.env.PPE_ADMIN_ORIGIN || "",
    branch: "ppe",
    serviceName: "learning-guide-ppe",
    serviceArn: process.env.PPE_APP_RUNNER_SERVICE_ARN || "",
    rollbackMode: "force-branch",
    requireDependencyChecks: true,
    requireVersionMatch: true,
    provisioned: false
  }
};

export function resolveReleaseEnvironment(name) {
  const key = String(name || "").trim().toUpperCase().replace("PPE/PROD", "PPE").replace("PROD", "PPE");
  const environment = releaseEnvironments[key];
  if (!environment) throw new Error(`Unknown release environment: ${name}`);
  return { name: key, ...environment };
}
