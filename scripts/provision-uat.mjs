// Operator-only Portal provisioning. Secrets use protected temporary files, never logs or Git.
// One script, one tier table: UAT (default) and Sandbox are independent deployments of the
// same code, so the environment namespaces below are the only place they differ
// (owner rule: environment = configuration namespace, no environment-specific code paths).
//
//   UAT (default; mirrors the SIT runtime-config template, imports SIT curriculum only):
//     node scripts/provision-uat.mjs --bootstrap
//     GITHUB_REF_NAME=uat node scripts/provision-uat.mjs --deploy
//
//   Sandbox (Course Sandbox, PRD v2.0 §3.1; same code as the UAT/Production baseline,
//   never imports SIT data; secrets live in learning-guide/sandbox/*, DB learning_guide_sandbox,
//   bucket prefix learning-guide/sandbox):
//     PORTAL_ENV=sandbox node scripts/provision-uat.mjs --bootstrap
//     PORTAL_ENV=sandbox GITHUB_REF_NAME=sandbox node scripts/provision-uat.mjs --deploy
//
// Sandbox secrets should be pre-created in learning-guide/sandbox/* when the provider
// credentials must be independent (Google/WeChat/SMTP/Stripe, provisioning request
// E2/E3/E5). Existing secrets are reused, never overwritten; missing ones fall back to
// the source environment's values exactly like UAT mirrored SIT.
//
// Sandbox open-all (owner 2026-11-24): Sandbox is no longer a course-only partition.
// AI Tutor, Helpdesk, Study Group/LiveKit and catalogue-pull integration variables are
// treated like SIT/UAT: non-secret values are copied from the source template, and
// secret values are reused from learning-guide/sandbox/* when pre-created (an existing
// Sandbox secret always wins). Environment-specific *_BASE_URL values are never copied:
// every one is set to a Sandbox origin (sandboxBaseUrls), and KS_TUTOR_API_KEY reuses the
// Admin Sandbox admin_api_key. Provider keys that are still absent are simply not
// written, so the feature degrades (Helpdesk 503, AI endpoints unavailable); the script
// never fabricates a key and never fails the provision because a key arrives later.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, mkdtempSync, cpSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Stripe from 'stripe';
import { checkRequiredCI } from './release/required-ci.mjs';
import { resolveReleaseEnvironment } from './release/environments.mjs';

const region = 'ap-southeast-1';

const sandboxOrigin = 'https://sandbox.ilovelearningguide.com';
const sandboxAdminOrigin = 'https://admin.sandbox.ilovelearningguide.com';

// A Sandbox service may only ever call itself. These are the only values an
// environment-specific *_BASE_URL may take in the Sandbox tier; deployVariablesFor
// drops every inherited *_BASE_URL first, then the tier applies this table. A key
// missing from the table fails the module-load invariant below (fail closed) instead
// of silently inheriting a UAT/SIT address. Semantics follow deploy/sandbox.example.env
// (LearningGuideAdmin): Admin-facing URLs point at the Sandbox Admin host, Portal-facing
// URLs at the Sandbox Portal host.
const sandboxBaseUrls = Object.freeze({
  ADMIN_PORTAL_BASE_URL: sandboxAdminOrigin,
  KS_TUTOR_BASE_URL: sandboxAdminOrigin,
  ADMIN_HELPDESK_BASE_URL: sandboxAdminOrigin,
  PORTAL_HELPDESK_BASE_URL: sandboxOrigin,
  PORTAL_STUDENTS_BASE_URL: sandboxOrigin,
  PORTAL_NOTIFICATIONS_BASE_URL: sandboxOrigin
});

export const tiers = {
  uat: {
    name: 'UAT',
    stackName: 'learning-guide-uat',
    origin: 'https://uat.ilovelearningguide.com',
    adminOrigin: 'https://admin.uat.ilovelearningguide.com',
    serviceName: 'learning-guide-uat',
    runtimeRoleName: 'learning-guide-uat-runtime',
    branch: 'uat',
    secretNamespace: 'learning-guide/uat',
    s3Prefix: 'learning-guide/uat',
    database: { name: 'learning_guide_uat', user: 'lg_uat_app' },
    webhookDescription: 'Learning Guide isolated UAT; sandbox only',
    // The legacy static-media archive is shared read-only (uat-course-media.json pins it).
    mediaArchiveReadPolicy: true,
    // Runtime-config template: the deployed service copies its variable/secret shape.
    sourceEnvironment: 'sit',
    bootstrapFile: 'deploy/uat-bootstrap.cjs',
    seedCurriculumFromSit: true,
    releaseHint: 'scripts/release-uat.mjs',
    // No cross-namespace secrets: every secret lives in learning-guide/uat/*.
    sharedSecrets: {},
    // UAT keeps today's OpenRouter site header; Sandbox sets its own origin below.
    deployVariables: { OPENROUTER_SITE_URL: 'https://uat.ilovelearningguide.com' }
  },
  sandbox: {
    name: 'SANDBOX',
    stackName: 'learning-guide-sandbox',
    origin: sandboxOrigin,
    adminOrigin: sandboxAdminOrigin,
    serviceName: 'learning-guide-sandbox',
    runtimeRoleName: 'learning-guide-sandbox-runtime',
    // Sandbox only ever runs the production baseline: the sandbox branch is a fast-forward
    // of the latest production release SHA (contract in LearningGuideSandbox docs).
    branch: process.env.SANDBOX_BRANCH || 'sandbox',
    secretNamespace: 'learning-guide/sandbox',
    s3Prefix: 'learning-guide/sandbox',
    database: { name: 'learning_guide_sandbox', user: 'lg_sandbox_app' },
    webhookDescription: 'Learning Guide isolated Sandbox; sandbox only',
    // deploy/sandbox-infrastructure.yml grants the runtime role only its own bucket
    // prefix (isolation checklist: cross-prefix AccessDenied); Sandbox does not get
    // the UAT archive-media read policy.
    mediaArchiveReadPolicy: false,
    sourceEnvironment: process.env.PROVISION_SOURCE_ENV || 'uat',
    // The UAT bootstrap Lambda hardcodes learning_guide_uat; Sandbox needs its own
    // bootstrap asset (role lg_sandbox_app + database learning_guide_sandbox) created
    // with the Sandbox infrastructure work, so this script fails closed without it.
    bootstrapFile: 'deploy/sandbox-bootstrap.cjs',
    // Sandbox never copies SIT curriculum: content arrives through authoring and packages.
    seedCurriculumFromSit: false,
    releaseHint: 'the Sandbox release workflow',
    // Sandbox open-all (owner 2026-11-24): no disabled-key pattern. AI Tutor,
    // Helpdesk, Study Group/LiveKit and catalogue-pull variables flow through exactly
    // like SIT/UAT; a value the source/operator does not provide is skipped and the
    // feature degrades, never fabricated.
    // Environment-specific *_BASE_URL values are the one exception: they are never
    // inherited (ownsBaseUrls + sandboxBaseUrls below), so Sandbox cannot call UAT.
    // Portal authenticates to Admin with the Admin Sandbox AUTH_TOKEN (provisioning
    // request §3.1/§3.3 pairing; course catalogue projection /api/portal/v1/** and the
    // learner runtime /api/user/**). It must reference the Admin Sandbox namespace,
    // never a copied UAT token, or every Portal -> Admin call answers 401; KS_TUTOR_API_KEY
    // is the same Admin token because /api/user/** validates X-API-Key against AUTH_TOKEN.
    sharedSecrets: {
      ADMIN_PORTAL_API_TOKEN: 'learning-guide/admin/sandbox/admin_api_key',
      KS_TUTOR_API_KEY: 'learning-guide/admin/sandbox/admin_api_key'
    },
    // Sandbox owns every base URL; see deployVariablesFor. Inherited UAT/SIT addresses
    // are dropped before the tier variables below are applied.
    ownsBaseUrls: true,
    deployVariables: {
      // ADMIN_HOSTS defaults to the admin.ilovelearningguide.com hosts; Sandbox must
      // serve its own admin host and route every Admin call to the Sandbox Admin.
      ADMIN_HOSTS: new URL(sandboxAdminOrigin).hostname,
      // Sandbox consumes Admin's read-only course projection (Sandbox plan §4.5).
      // Every other tier keeps the default `store`; the switch is configuration,
      // never an environment branch in product code.
      PORTAL_COURSE_SOURCE: 'admin',
      // Like UAT, Sandbox sends its own origin as the OpenRouter site header once the
      // AI Tutor key is configured. Not a key: it cannot make AI work by itself.
      OPENROUTER_SITE_URL: sandboxOrigin,
      ...sandboxBaseUrls
    }
  }
};

// Fail closed at load time: every Sandbox base URL must be the Sandbox origin defined
// above. A missing/renamed key would otherwise let the service start with no address
// (or, worse, a future edit could reintroduce a UAT value) without an obvious failure.
for (const [key, value] of Object.entries(sandboxBaseUrls)) {
  if (!/_BASE_URL$/.test(key) || tiers.sandbox.deployVariables[key] !== value) {
    throw new Error(`Sandbox ${key} must be fixed to ${value}; inherited source addresses are not allowed`);
  }
}

export function keyDisabledFor(tier, key) {
  return Boolean(tier.disabledKeyPattern?.test(key));
}

/**
 * Runtime variables copied from the source service template into the new service.
 * Secret values never travel as plain variables, fixed deployment keys are set
 * explicitly below, and a tier's disabled keys (if it declares any) are dropped
 * before they can reach the environment. A tier that owns its base URLs
 * (ownsBaseUrls, currently Sandbox) also drops every inherited *_BASE_URL, so an
 * environment-specific address is always taken from the tier table, never the source.
 */
const SECRET_OR_FIXED_KEY = /(SECRET|PASSWORD|TOKEN|DATABASE_URL|SMTP_PASS|OPENROUTER_API_KEY|WECHAT_APP_ID|APP_VERSION|APP_ENV|NEXT_PUBLIC_APP_URL|OPENROUTER_SITE_URL|DATA_S3_|STORAGE_BACKEND)/;
const ENVIRONMENT_BASE_URL = /_BASE_URL$/;
export function deployVariablesFor(tier, runtimeVariables) {
  return Object.fromEntries(
    Object.entries(runtimeVariables).filter(([key]) =>
      !SECRET_OR_FIXED_KEY.test(key)
      && !keyDisabledFor(tier, key)
      && !(tier.ownsBaseUrls && ENVIRONMENT_BASE_URL.test(key))
    )
  );
}

/**
 * Source credential keys copied into the tier namespace (existing secrets are reused).
 * Every tier copies the same keys: Sandbox is no longer a course-only partition, so an
 * AI/Helpdesk credential the source provides is copied like UAT; one it does not
 * provide is skipped below and the feature degrades.
 */
const CREDENTIAL_KEYS = ['GOOGLE_CLIENT_SECRET','WECHAT_APP_ID','WECHAT_APP_SECRET','OPENROUTER_API_KEY','STRIPE_SECRET_KEY','SMTP_PASS','DOCUMENTS_AWS_ACCESS_KEY_ID','DOCUMENTS_AWS_SECRET_ACCESS_KEY'];
// Provider credentials that may legitimately be absent (AI Tutor key added by ops
// later, optional document storage). Missing ones are skipped, never fabricated.
const OPTIONAL_SOURCE_CREDENTIALS = new Set(['OPENROUTER_API_KEY','DOCUMENTS_AWS_ACCESS_KEY_ID','DOCUMENTS_AWS_SECRET_ACCESS_KEY']);
export function credentialCopyKeysFor(tier) {
  return CREDENTIAL_KEYS.filter((key) => !keyDisabledFor(tier, key));
}

function invokedDirectly() {
  if (!process.argv[1]) return false;
  const entry = pathToFileURL(process.argv[1]).href;
  let realEntry = entry;
  try { realEntry = pathToFileURL(realpathSync(process.argv[1])).href; } catch { /* keep the literal entry URL */ }
  return import.meta.url === entry || import.meta.url === realEntry;
}

// The tier table and partition helpers above are imported by
// tests/unit/provision-sandbox-partition.test.mjs; every AWS/Stripe action lives
// inside runProvisioner() so importing the module never touches AWS.
if (invokedDirectly()) {
  runProvisioner().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
  });
}

async function runProvisioner() {
const tierName = (process.env.PORTAL_ENV || 'uat').trim().toLowerCase();
const tier = tiers[tierName];
if (!tier) throw new Error(`PORTAL_ENV must be one of ${Object.keys(tiers).join(', ')}`);
// Fail before any AWS call when the tier's bootstrap asset is not in the tree.
if (process.argv.includes('--bootstrap') && !existsSync(tier.bootstrapFile)) {
  throw new Error(`${tier.name} bootstrap requires ${tier.bootstrapFile} (creates ${tier.database.name} and role ${tier.database.user}); it is owned by the ${tier.name} infrastructure work and is not created by this provisioner`);
}

if (process.argv.includes('--deploy')) {
  checkRequiredCI({ sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), branch: tier.branch });
}
function aws(service, operation, input = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'lg-aws-'));
  const file = path.join(dir, 'input.json');
  try {
    writeFileSync(file, JSON.stringify(input), { mode: 0o600 });
    return JSON.parse(execFileSync('aws', [service, operation, '--region', region, '--output', 'json', '--cli-input-json', `file://${file}`], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 20 * 1024 * 1024 }) || '{}');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
function optional(service, operation, input) {
  try { return aws(service, operation, input); }
  catch (error) {
    if (/ResourceNotFound|does not exist|NoSuchEntity/i.test(String(error.stderr))) return null;
    throw new Error(`${service} ${operation} failed; inspect AWS audit logs (secret output suppressed)`);
  }
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const identity = aws('sts', 'get-caller-identity');
if (identity.Account !== '851987565851') throw new Error('Wrong AWS account');
const stack = aws('cloudformation', 'describe-stacks', { StackName: tier.stackName }).Stacks[0];
if (!['CREATE_COMPLETE', 'UPDATE_COMPLETE'].includes(stack.StackStatus)) throw new Error(`Infrastructure not ready: ${stack.StackStatus}`);
const out = Object.fromEntries(stack.Outputs.map(x => [x.OutputKey, x.OutputValue]));
if (tier.mediaArchiveReadPolicy) {
  aws('iam', 'put-role-policy', {
    RoleName: tier.runtimeRoleName,
    PolicyName: 'course-media-archive-read-only',
    PolicyDocument: JSON.stringify({
      Version: '2012-10-17',
      Statement: [{
        Sid: 'ReadStaticCourseMedia',
        Effect: 'Allow',
        Action: ['s3:GetObject', 's3:GetObjectVersion'],
        Resource: 'arn:aws:s3:::aitutor-data-851987565851/learning-guide/dev/documents/mvp/*'
      }]
    })
  });
}
const sourceEnvironment = resolveReleaseEnvironment(tier.sourceEnvironment);
if (!sourceEnvironment.serviceArn) throw new Error(`Source environment ${sourceEnvironment.name} has no App Runner service ARN to read the runtime-config template from`);
const source = aws('apprunner', 'describe-service', { ServiceArn: sourceEnvironment.serviceArn }).Service;
const config = source.SourceConfiguration.CodeRepository.CodeConfiguration.CodeConfigurationValues;
const original = { ...config.RuntimeEnvironmentVariables };
for (const [key, arn] of Object.entries(config.RuntimeEnvironmentSecrets || {})) {
  // Disabled keys (if a tier declares any) are never read out of the source environment.
  if (keyDisabledFor(tier, key)) continue;
  original[key] = aws('secretsmanager', 'get-secret-value', { SecretId: arn }).SecretString;
}
const secretArns = {};
function secret(key, value) {
  const Name = `${tier.secretNamespace}/${key.toLowerCase()}`;
  const existing = optional('secretsmanager', 'describe-secret', { SecretId: Name });
  if (!existing) secretArns[key] = aws('secretsmanager', 'create-secret', { Name, SecretString: value, Tags: [{ Key: 'Environment', Value: tier.name }] }).ARN;
  else {
    secretArns[key] = existing.ARN;
    // Do not overwrite existing secrets on re-run (session / webhook / db password).
  }
  return aws('secretsmanager', 'get-secret-value', { SecretId: secretArns[key] }).SecretString;
}
const existingDb = optional('secretsmanager', 'describe-secret', { SecretId: `${tier.secretNamespace}/database_url` });
if (!existingDb) secret('DATABASE_URL', `postgresql://${tier.database.user}:${randomBytes(32).toString('hex')}@${out.DatabaseHost}:5432/${tier.database.name}`);
else secretArns.DATABASE_URL = existingDb.ARN;
const existingSession = optional('secretsmanager', 'describe-secret', { SecretId: `${tier.secretNamespace}/session_secret` });
if (!existingSession) secret('SESSION_SECRET', randomBytes(48).toString('hex'));
else secretArns.SESSION_SECRET = existingSession.ARN;
for (const key of credentialCopyKeysFor(tier)) {
  if (!original[key]) {
    if (OPTIONAL_SOURCE_CREDENTIALS.has(key)) continue;
    throw new Error(`Source credential missing: ${key}`);
  }
  secret(key, original[key]);
}
if (!original.SMTP_HOST || !original.SMTP_USER || !original.SMTP_PASS) throw new Error('Source SMTP credential missing');
if (!original.STRIPE_SECRET_KEY.startsWith('sk_test_')) throw new Error(`${tier.name} refuses live Stripe keys`);
const stripe = new Stripe(original.STRIPE_SECRET_KEY);
const url = `${tier.origin}/api/payment/webhook`;
const events = ['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired','invoice.paid','invoice.payment_failed','customer.subscription.updated','customer.subscription.deleted','charge.refunded','charge.refund.updated','refund.created','refund.updated','refund.failed'];
let webhook = (await stripe.webhookEndpoints.list({ limit: 100 })).data.find(x => x.url === url);
if (!webhook) {
  webhook = await stripe.webhookEndpoints.create({ url, enabled_events: events, description: tier.webhookDescription });
  secret('STRIPE_WEBHOOK_SECRET', webhook.secret);
} else {
  await stripe.webhookEndpoints.update(webhook.id, { enabled_events: events });
  const saved = optional('secretsmanager', 'describe-secret', { SecretId: `${tier.secretNamespace}/stripe_webhook_secret` });
  if (!saved) throw new Error('Existing webhook has no stored signing secret; rotate it before deployment');
  secretArns.STRIPE_WEBHOOK_SECRET = saved.ARN;
}

if (process.argv.includes('--bootstrap')) {
  const roleName = `${tier.serviceName}-bootstrap`;
  const role = optional('iam', 'get-role', { RoleName: roleName })?.Role || aws('iam', 'create-role', { RoleName: roleName, AssumeRolePolicyDocument: JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }] }) }).Role;
  aws('iam', 'attach-role-policy', { RoleName: roleName, PolicyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole' });
  aws('iam', 'put-role-policy', { RoleName: roleName, PolicyName: 'bootstrap-secrets', PolicyDocument: JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 'secretsmanager:GetSecretValue', Resource: [out.MasterSecret, secretArns.DATABASE_URL] }] }) });
  const temp = mkdtempSync(path.join(tmpdir(), `lg-${tierName}-`));
  try {
    cpSync(tier.bootstrapFile, path.join(temp, 'index.cjs'));
    cpSync('deploy/rds-ap-southeast-1.pem', path.join(temp, 'ca.pem'));
    cpSync('db/migrations/009_product_payment_keys.sql', path.join(temp, '009_product_payment_keys.sql'));
    cpSync('db/migrations/010_orm_runtime.sql', path.join(temp, '010_orm_runtime.sql'));
    const copied = new Set();
    function copyDependency(name) {
      if (copied.has(name)) return;
      copied.add(name);
      const sourcePath = `node_modules/${name}`;
      cpSync(sourcePath, path.join(temp, 'node_modules', name), { recursive: true });
      const manifest = JSON.parse(readFileSync(`${sourcePath}/package.json`, 'utf8'));
      for (const dependency of Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies })) copyDependency(dependency);
    }
    copyDependency('pg');
    execFileSync('zip', ['-qr', 'function.zip', 'index.cjs', 'ca.pem', '009_product_payment_keys.sql', '010_orm_runtime.sql', 'node_modules'], { cwd: temp });
    const FunctionName = `${tier.serviceName}-bootstrap`;
    const existing = optional('lambda', 'get-function', { FunctionName });
    if (!existing) {
      await sleep(15000);
      aws('lambda', 'create-function', { FunctionName, Runtime: 'nodejs22.x', Role: role.Arn, Handler: 'index.handler', Timeout: 120, MemorySize: 256, Code: { ZipFile: readFileSync(path.join(temp, 'function.zip')).toString('base64') }, VpcConfig: { SubnetIds: [out.PrivateSubnet], SecurityGroupIds: [out.AppSecurityGroup] }, Environment: { Variables: { MASTER_SECRET: out.MasterSecret, APP_SECRET: secretArns.DATABASE_URL, DB_HOST: out.DatabaseHost } } });
    } else {
      aws('lambda', 'update-function-code', { FunctionName, ZipFile: readFileSync(path.join(temp, 'function.zip')).toString('base64') });
    }
    for (let i = 0; i < 60; i++) {
      const state = aws('lambda', 'get-function-configuration', { FunctionName });
      if (state.State === 'Active' && state.LastUpdateStatus !== 'InProgress') break;
      await sleep(5000);
    }
    let product = null;
    if (tier.seedCurriculumFromSit) {
      // Import curriculum from SIT via a temporary VPC Lambda (laptop cannot reach private RDS).
      const sitStack = aws('cloudformation', 'describe-stacks', { StackName: 'learning-guide-sit' }).Stacks[0];
      const sitOut = Object.fromEntries(sitStack.Outputs.map(x => [x.OutputKey, x.OutputValue]));
      const sitDbSecret = optional('secretsmanager', 'describe-secret', { SecretId: 'learning-guide/sit/database_url' });
      if (!sitDbSecret) throw new Error('SIT DATABASE_URL secret is required to seed UAT curriculum');
      const exportTemp = mkdtempSync(path.join(tmpdir(), 'lg-uat-export-'));
      try {
        cpSync('deploy/export-curriculum.cjs', path.join(exportTemp, 'index.cjs'));
        cpSync('deploy/rds-ap-southeast-1.pem', path.join(exportTemp, 'ca.pem'));
        const copiedExport = new Set();
        function copyExportDependency(name) {
          if (copiedExport.has(name)) return;
          copiedExport.add(name);
          const sourcePath = `node_modules/${name}`;
          cpSync(sourcePath, path.join(exportTemp, 'node_modules', name), { recursive: true });
          const manifest = JSON.parse(readFileSync(`${sourcePath}/package.json`, 'utf8'));
          for (const dependency of Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies })) copyExportDependency(dependency);
        }
        copyExportDependency('pg');
        execFileSync('zip', ['-qr', 'function.zip', 'index.cjs', 'ca.pem', 'node_modules'], { cwd: exportTemp });
        const ExportName = 'learning-guide-uat-export-sit';
        const exportRoleName = 'learning-guide-uat-export';
        const exportRole = optional('iam', 'get-role', { RoleName: exportRoleName })?.Role || aws('iam', 'create-role', { RoleName: exportRoleName, AssumeRolePolicyDocument: JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }] }) }).Role;
        aws('iam', 'attach-role-policy', { RoleName: exportRoleName, PolicyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole' });
        aws('iam', 'put-role-policy', { RoleName: exportRoleName, PolicyName: 'export-sit-db', PolicyDocument: JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 'secretsmanager:GetSecretValue', Resource: [sitDbSecret.ARN] }] }) });
        const exportExisting = optional('lambda', 'get-function', { FunctionName: ExportName });
        if (!exportExisting) {
          await sleep(15000);
          aws('lambda', 'create-function', { FunctionName: ExportName, Runtime: 'nodejs22.x', Role: exportRole.Arn, Handler: 'index.handler', Timeout: 60, MemorySize: 256, Code: { ZipFile: readFileSync(path.join(exportTemp, 'function.zip')).toString('base64') }, VpcConfig: { SubnetIds: [sitOut.PrivateSubnet], SecurityGroupIds: [sitOut.AppSecurityGroup] }, Environment: { Variables: { APP_SECRET: sitDbSecret.ARN } } });
        } else {
          aws('lambda', 'update-function-code', { FunctionName: ExportName, ZipFile: readFileSync(path.join(exportTemp, 'function.zip')).toString('base64') });
        }
        for (let i = 0; i < 60; i++) {
          const state = aws('lambda', 'get-function-configuration', { FunctionName: ExportName });
          if (state.State === 'Active' && state.LastUpdateStatus !== 'InProgress') break;
          await sleep(5000);
        }
        const exportResultFile = path.join(exportTemp, 'result.json');
        const exportResponse = JSON.parse(execFileSync('aws', ['lambda','invoke','--region',region,'--function-name',ExportName,'--cli-binary-format','raw-in-base64-out','--payload','{}',exportResultFile], { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }));
        const exportResult = JSON.parse(readFileSync(exportResultFile, 'utf8'));
        if (exportResponse.FunctionError || !exportResult.ok) throw new Error(`SIT curriculum export failed: ${exportResult.errorType || 'see restricted Lambda logs'}`);
        product = exportResult.product || {};
        aws('lambda', 'delete-function', { FunctionName: ExportName });
        aws('iam', 'delete-role-policy', { RoleName: exportRoleName, PolicyName: 'export-sit-db' });
        aws('iam', 'detach-role-policy', { RoleName: exportRoleName, PolicyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole' });
      } finally { rmSync(exportTemp, { recursive: true, force: true }); }
    }
    // Sandbox sends no product: schema only, no SIT learner/curriculum data.
    const payload = JSON.stringify(tier.seedCurriculumFromSit ? { product } : {});
    writeFileSync(path.join(temp, 'payload.json'), payload, { mode: 0o600 });
    const resultFile = path.join(temp, 'result.json');
    const response = JSON.parse(execFileSync('aws', ['lambda','invoke','--region',region,'--function-name',FunctionName,'--cli-binary-format','raw-in-base64-out','--payload',`file://${path.join(temp, 'payload.json')}`,resultFile], { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }));
    const result = JSON.parse(readFileSync(resultFile, 'utf8'));
    if (response.FunctionError || !result.ok) throw new Error(`Database bootstrap failed: ${result.errorType || 'see restricted Lambda logs'}`);
    console.log(JSON.stringify({ database: result, courses: Array.isArray(product?.courses) ? product.courses.length : 0 }));
    aws('lambda', 'delete-function', { FunctionName });
    aws('iam', 'delete-role-policy', { RoleName: roleName, PolicyName: 'bootstrap-secrets' });
    aws('iam', 'detach-role-policy', { RoleName: roleName, PolicyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole' });
  } finally { rmSync(temp, { recursive: true, force: true }); }
  const marker = Buffer.from(`Learning Guide ${tier.name} storage readiness`);
  aws('s3api', 'put-object', { Bucket: out.BucketName, Key: `${tier.s3Prefix}/.deployment-ready` });
  console.log(JSON.stringify({ storage: out.BucketName, marker: marker.length, webhook: webhook.id, events: events.length }));
}

if (process.argv.includes('--deploy')) {
  const sha = execFileSync('git', ['rev-parse','HEAD'], { encoding: 'utf8' }).trim();
  const branch = process.env.GITHUB_REF_NAME || tier.branch;
  if (branch !== tier.branch) throw new Error(`GITHUB_REF_NAME=${branch} conflicts with the ${tier.name} deployment branch ${tier.branch}`);
  const variables = deployVariablesFor(tier, config.RuntimeEnvironmentVariables);
  Object.assign(variables, {
    APP_ENV: tier.name, NODE_ENV: 'production', APP_VERSION: sha,
    NEXT_PUBLIC_APP_URL: tier.origin,
    DATA_S3_BUCKET: out.BucketName, DATA_S3_PREFIX: tier.s3Prefix, STORAGE_BACKEND: 'postgresql',
    DATABASE_CA_FILE: 'deploy/rds-ap-southeast-1.pem', PAYMENT_MODE: 'stripe', STRIPE_SANDBOX: '1',
    LOCAL_SOCIAL_LOGIN: '0', EMAIL_VERIFICATION_REQUIRED: '1',
    SMTP_HOST: original.SMTP_HOST, SMTP_USER: original.SMTP_USER,
    SMTP_PORT: original.SMTP_PORT || '465', SMTP_SECURE: original.SMTP_SECURE || '1',
    SMTP_FROM: original.SMTP_FROM || original.SMTP_USER,
    ...tier.deployVariables
  });
  // Ensure every secret key used by the source template is present in this tier.
  for (const key of Object.keys(config.RuntimeEnvironmentSecrets || {})) {
    if (tier.sharedSecrets[key]) continue;
    // An existing tier-namespace secret for a disabled key is left unattached.
    if (keyDisabledFor(tier, key)) continue;
    if (!secretArns[key]) {
      const Name = `${tier.secretNamespace}/${key.toLowerCase()}`;
      const existing = optional('secretsmanager', 'describe-secret', { SecretId: Name });
      if (existing) secretArns[key] = existing.ARN;
    }
  }
  // Cross-namespace pairs (Sandbox Admin AUTH_TOKEN) must exist before deployment.
  for (const [key, secretId] of Object.entries(tier.sharedSecrets)) {
    const existing = optional('secretsmanager', 'describe-secret', { SecretId: secretId });
    if (!existing) throw new Error(`Shared secret ${secretId} (${key}) is missing; provision the Admin stack first`);
    secretArns[key] = existing.ARN;
  }
  let sourceConfig = {
    ...source.SourceConfiguration,
    AutoDeploymentsEnabled: false,
    CodeRepository: {
      ...source.SourceConfiguration.CodeRepository,
      SourceCodeVersion: { Type: 'BRANCH', Value: branch },
      CodeConfiguration: {
        ConfigurationSource: 'API',
        CodeConfigurationValues: {
          Runtime: 'NODEJS_22',
          BuildCommand: 'npm ci && npm run build',
          StartCommand: 'npm run start -- -p 8080',
          Port: '8080',
          RuntimeEnvironmentVariables: variables,
          RuntimeEnvironmentSecrets: secretArns
        }
      }
    }
  };
  const services = aws('apprunner','list-services').ServiceSummaryList;
  const existing = services.find(x => x.ServiceName === tier.serviceName);
  if (existing) throw new Error(`${tier.name} already exists. Use ${tier.releaseHint} with mandatory acceptance, not the initial provisioner.`);
  const common = {
    SourceConfiguration: sourceConfig,
    InstanceConfiguration: { Cpu: '1024', Memory: '2048', InstanceRoleArn: out.AppRoleArn },
    HealthCheckConfiguration: { Protocol: 'HTTP', Path: '/api/health', Interval: 20, Timeout: 20, HealthyThreshold: 1, UnhealthyThreshold: 5 },
    AutoScalingConfigurationArn: out.ScalingArn,
    NetworkConfiguration: { EgressConfiguration: { EgressType: 'VPC', VpcConnectorArn: out.ConnectorArn }, IngressConfiguration: { IsPubliclyAccessible: true } }
  };
  const response = existing
    ? aws('apprunner','update-service', { ServiceArn: existing.ServiceArn, ...common })
    : aws('apprunner','create-service', { ServiceName: tier.serviceName, ...common, Tags: [{ Key: 'Project', Value: 'LearningGuide' }, { Key: 'Environment', Value: tier.name }] });
  console.log(JSON.stringify({ arn: response.Service.ServiceArn, url: response.Service.ServiceUrl, operation: response.OperationId, version: sha, branch }));
  console.error(`Provisioning submitted, not accepted. After DNS/service readiness run ${tier.releaseHint} before declaring a release.`);
  process.exitCode = 2;
}
}
