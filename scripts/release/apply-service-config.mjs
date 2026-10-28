#!/usr/bin/env node
/**
 * 应用 App Runner 环境配置，并强制校验部署结果（2026-10-28 复盘 A6 + A7）。
 *
 * 为什么需要它：本次事故中我用 `update-service` 直接改线上配置，踩了两个坑：
 *  1. 写入 `RuntimeEnvironmentSecrets` 时，若实例角色无权读取该 Secret，
 *     AWS 会返回 **UPDATE_SERVICE ROLLBACK_SUCCEEDED** —— 配置没生效，
 *     但命令本身不报错，我以为成功了（A6）。
 *  2. 新 Secret 必须先给实例角色授权，否则必然回滚（A7）。
 *
 * 本脚本把两件事绑在一起：
 *  - 自动为每个将被注入的 Secret 写入（幂等的）内联策略，授权实例角色读取；
 *  - 提交 update-service 后轮询 OperationStatus，只要不是 SUCCEEDED
 *    （含 ROLLBACK_SUCCEEDED）就以非零退出并打印 OperationSummary。
 *
 * 用法：
 *   node scripts/release/apply-service-config.mjs --plan /tmp/plan.json [--dry-run]
 *
 * plan.json（只写 ARN / 名称，绝不写密钥明文）：
 *   {
 *     "serviceArn": "arn:aws:apprunner:...",
 *     "environmentVariables": { "KS_TUTOR_BASE_URL": "https://admin..." },
 *     "environmentSecrets": { "KS_TUTOR_API_KEY": "learning-guide/dev/ks_tutor_api_key" },
 *     "removeVariables": [],
 *     "removeSecrets": []
 *   }
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const REGION = process.env.AWS_REGION || "ap-southeast-1";
const POLL_MS = Number(process.env.APP_RUNNER_POLL_MS || 15_000);
const TIMEOUT_MS = Number(process.env.APP_RUNNER_TIMEOUT_MS || 25 * 60_000);

function aws(service, operation, input = {}, { tolerateFailure = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "lg-apply-"));
  try {
    const file = path.join(dir, "input.json");
    writeFileSync(file, JSON.stringify(input), { mode: 0o600 });
    const args = [service, operation, "--region", REGION, "--output", "json"];
    if (Object.keys(input).length) args.push("--cli-input-json", `file://${file}`);
    try {
      return JSON.parse(execFileSync("aws", args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }) || "{}");
    } catch (error) {
      if (tolerateFailure) return null;
      throw new Error(`${service} ${operation} failed: ${String(error.stderr || error.message).slice(-400)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 稳定序列化，便于比较"配置是否真的变了"。 */
function sortKeys(value) {
  return Object.fromEntries(Object.keys(value || {}).sort().map((key) => [key, value[key]]));
}

function parseArgs(argv) {
  const out = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--plan") out.plan = argv[++i];
    else if (argv[i] === "--dry-run") out.dryRun = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!out.plan) throw new Error("--plan <file> is required");
  return out;
}

/** Secret 名称或 ARN 都接受；返回完整 ARN。 */
function resolveSecretArn(nameOrArn) {
  if (String(nameOrArn).startsWith("arn:aws:secretsmanager:")) return nameOrArn;
  return aws("secretsmanager", "describe-secret", { SecretId: nameOrArn }).ARN;
}

/** 从实例角色 ARN 取角色名，便于 put-role-policy。 */
function roleNameFromArn(arn) {
  const match = /^arn:aws:iam::\d+:role\/(.+)$/.exec(String(arn || ""));
  if (!match) throw new Error(`Cannot derive a role name from ${arn}`);
  return match[1];
}

/**
 * 幂等授权：把新 Secret 加进该角色已有的内联策略 `lg-secret-access`。
 * 只表达"能读这些 Secret"，不覆盖角色上其他策略。
 */
function grantSecretAccess({ instanceRoleArn, secretArns, dryRun }) {
  if (!secretArns.length) return { policyName: null, added: [] };
  const roleName = roleNameFromArn(instanceRoleArn);
  const policyName = "lg-secret-access";
  const existing = aws("iam", "get-role-policy", { RoleName: roleName, PolicyName: policyName }, { tolerateFailure: true });
  const statements = existing?.PolicyDocument?.Statement ? [...existing.PolicyDocument.Statement] : [];
  const resources = new Set();
  for (const statement of statements) {
    if (statement?.Action && JSON.stringify(statement.Action).includes("secretsmanager:GetSecretValue")) {
      for (const item of Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource]) resources.add(item);
    }
  }
  const added = secretArns.filter((arn) => !resources.has(arn) && ![...resources].some((r) => r.endsWith("-*") && arn.startsWith(r.slice(0, -1))));
  for (const arn of added) resources.add(arn);
  if (!added.length) return { policyName, added };
  const document = {
    Version: "2012-10-17",
    Statement: [{
      Effect: "Allow",
      Action: "secretsmanager:GetSecretValue",
      Resource: [...resources].sort(),
    }],
  };
  if (dryRun) return { policyName, added, dryRun: true };
  aws("iam", "put-role-policy", {
    RoleName: roleName,
    PolicyName: policyName,
    PolicyDocument: JSON.stringify(document),
  });
  return { policyName, added };
}

async function waitForOperation(serviceArn, operationId) {
  const deadline = Date.now() + TIMEOUT_MS;
  const TERMINAL = new Set(["SUCCEEDED", "FAILED", "ROLLBACK_SUCCEEDED", "ROLLBACK_FAILED"]);
  let status = "PENDING";
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const operations = aws("apprunner", "list-operations", { ServiceArn: serviceArn, MaxResults: 20 }).OperationSummaryList || [];
    const current = operations.find((item) => item.Id === operationId);
    status = current?.Status ?? "PENDING";
    console.log(JSON.stringify({ operationId, status }));
    if (TERMINAL.has(status)) return status;
  }
  return "TIMEOUT";
}

async function main() {
  const { plan: planPath, dryRun } = parseArgs(process.argv.slice(2));
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  const serviceArn = plan.serviceArn;
  if (!serviceArn) throw new Error("plan.serviceArn is required");

  const service = aws("apprunner", "describe-service", { ServiceArn: serviceArn }).Service;
  // 服务不在 RUNNING 时 update-service 必然被拒；提前失败比后面看一条
  // InvalidRequestException 更清楚（本次事故里也踩过这个）。
  if (service.Status !== "RUNNING") {
    throw new Error(`Service is ${service.Status}; wait for the running deployment to finish before applying configuration.`);
  }
  const configuration = service.SourceConfiguration.CodeRepository
    ? service.SourceConfiguration.CodeRepository.CodeConfiguration.CodeConfigurationValues
    : service.SourceConfiguration.ImageRepository.ImageConfiguration;
  const env = { ...(configuration.RuntimeEnvironmentVariables || {}) };
  const secrets = { ...(configuration.RuntimeEnvironmentSecrets || {}) };

  for (const key of plan.removeVariables || []) delete env[key];
  for (const key of plan.removeSecrets || []) delete secrets[key];
  Object.assign(env, plan.environmentVariables || {});

  const secretArns = {};
  for (const [key, ref] of Object.entries(plan.environmentSecrets || {})) {
    secretArns[key] = resolveSecretArn(ref);
    secrets[key] = secretArns[key];
  }

  // 先授权再提交：顺序反了必然回滚。
  const grant = grantSecretAccess({
    instanceRoleArn: service.InstanceConfiguration?.InstanceRoleArn,
    secretArns: Object.values(secretArns),
    dryRun,
  });

  const planSummary = {
    dryRun,
    service: serviceArn,
    status: service.Status,
    addedVariables: Object.keys(plan.environmentVariables || {}),
    removedVariables: plan.removeVariables || [],
    addedSecrets: Object.keys(secretArns),
    removedSecrets: plan.removeSecrets || [],
    iamPolicy: grant.policyName,
    iamAddedResources: grant.added.length,
  };
  const beforeEnv = configuration.RuntimeEnvironmentVariables || {};
  const beforeSecrets = configuration.RuntimeEnvironmentSecrets || {};
  const unchanged = JSON.stringify(sortKeys(beforeEnv)) === JSON.stringify(sortKeys(env))
    && JSON.stringify(sortKeys(beforeSecrets)) === JSON.stringify(sortKeys(secrets));
  if (unchanged) {
    // 配置已一致时不调用 update-service：AWS 会把它当成 no-op，既不产生
    // Operation，也无法据此判断"是否生效"。直接报告一致性，避免误报失败。
    console.log(JSON.stringify({ ...planSummary, result: "unchanged" }, null, 2));
    return;
  }
  if (dryRun) {
    console.log(JSON.stringify({ ...planSummary, result: "dry-run" }, null, 2));
    return;
  }

  configuration.RuntimeEnvironmentVariables = env;
  configuration.RuntimeEnvironmentSecrets = secrets;

  // 某些 CLI/SDK 版本的 update-service 只返回 Service、不返回 OperationId，
  // 因此先用"提交前最新 operation id"做基线，提交后取新增的那一条。
  const beforeId = (aws("apprunner", "list-operations", { ServiceArn: serviceArn, MaxResults: 1 }).OperationSummaryList || [])[0]?.Id;
  const update = aws("apprunner", "update-service", { ServiceArn: serviceArn, SourceConfiguration: service.SourceConfiguration });
  let operationId = update.OperationId;
  if (!operationId) {
    for (let i = 0; i < 10 && !operationId; i++) {
      await sleep(1_500);
      const latest = (aws("apprunner", "list-operations", { ServiceArn: serviceArn, MaxResults: 1 }).OperationSummaryList || [])[0];
      if (latest && latest.Id !== beforeId) operationId = latest.Id;
    }
  }
  if (!operationId) throw new Error("update-service did not create an observable operation");
  const status = await waitForOperation(serviceArn, operationId);

  const finalStatus = aws("apprunner", "describe-service", { ServiceArn: serviceArn }).Service.Status;
  console.log(JSON.stringify({ ...planSummary, operationId, operationStatus: status, serviceStatus: finalStatus }, null, 2));

  // ROLLBACK_SUCCEEDED 不是成功：配置没有生效，只是服务回到了旧版本。
  if (status !== "SUCCEEDED") {
    throw new Error(`App Runner did not apply the configuration (${status}). Service is ${finalStatus}.`);
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: String(error.message || error) }));
  process.exit(1);
});
