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
    rollbackMode: "revert-commit",
    requireDependencyChecks: false,
    requireVersionMatch: true,
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
    adminOrigin: "https://admin.uat.ilovelearningguide.com",
    branch: "uat",
    serviceName: "learning-guide-uat",
    serviceArn: process.env.UAT_APP_RUNNER_SERVICE_ARN || "",
    rollbackMode: "force-branch",
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
