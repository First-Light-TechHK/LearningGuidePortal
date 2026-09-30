// Operator-only UAT setup. Secrets use protected temporary files, never logs or Git.
// Mirrors SIT; curriculum is copied from the live SIT store (no learner data).
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, mkdtempSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Stripe from 'stripe';

const region = 'ap-southeast-1';
const sitArn = 'arn:aws:apprunner:ap-southeast-1:851987565851:service/learning-guide-sit/5b9b982e873e4f08ad2f5a50f67d67d0';
const origin = 'https://uat.ilovelearningguide.com';
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
const stack = aws('cloudformation', 'describe-stacks', { StackName: 'learning-guide-uat' }).Stacks[0];
if (!['CREATE_COMPLETE', 'UPDATE_COMPLETE'].includes(stack.StackStatus)) throw new Error(`Infrastructure not ready: ${stack.StackStatus}`);
const out = Object.fromEntries(stack.Outputs.map(x => [x.OutputKey, x.OutputValue]));
const source = aws('apprunner', 'describe-service', { ServiceArn: sitArn }).Service;
const config = source.SourceConfiguration.CodeRepository.CodeConfiguration.CodeConfigurationValues;
const original = { ...config.RuntimeEnvironmentVariables };
for (const [key, arn] of Object.entries(config.RuntimeEnvironmentSecrets || {})) original[key] = aws('secretsmanager', 'get-secret-value', { SecretId: arn }).SecretString;
const secretArns = {};
function secret(key, value) {
  const Name = `learning-guide/uat/${key.toLowerCase()}`;
  const existing = optional('secretsmanager', 'describe-secret', { SecretId: Name });
  if (!existing) secretArns[key] = aws('secretsmanager', 'create-secret', { Name, SecretString: value, Tags: [{ Key: 'Environment', Value: 'UAT' }] }).ARN;
  else {
    secretArns[key] = existing.ARN;
    // Do not overwrite existing UAT secrets on re-run (session / webhook / db password).
  }
  return aws('secretsmanager', 'get-secret-value', { SecretId: secretArns[key] }).SecretString;
}
const existingDb = optional('secretsmanager', 'describe-secret', { SecretId: 'learning-guide/uat/database_url' });
if (!existingDb) secret('DATABASE_URL', `postgresql://lg_uat_app:${randomBytes(32).toString('hex')}@${out.DatabaseHost}:5432/learning_guide_uat`);
else secretArns.DATABASE_URL = existingDb.ARN;
const existingSession = optional('secretsmanager', 'describe-secret', { SecretId: 'learning-guide/uat/session_secret' });
if (!existingSession) secret('SESSION_SECRET', randomBytes(48).toString('hex'));
else secretArns.SESSION_SECRET = existingSession.ARN;
for (const key of ['GOOGLE_CLIENT_SECRET','WECHAT_APP_ID','WECHAT_APP_SECRET','OPENROUTER_API_KEY','STRIPE_SECRET_KEY','SMTP_PASS','DOCUMENTS_AWS_ACCESS_KEY_ID','DOCUMENTS_AWS_SECRET_ACCESS_KEY']) {
  if (!original[key]) {
    if (key.startsWith('DOCUMENTS_AWS_')) continue;
    throw new Error(`Source credential missing: ${key}`);
  }
  secret(key, original[key]);
}
if (!original.SMTP_HOST || !original.SMTP_USER || !original.SMTP_PASS) throw new Error('Source SMTP credential missing');
if (!original.STRIPE_SECRET_KEY.startsWith('sk_test_')) throw new Error('UAT refuses live Stripe keys');
const stripe = new Stripe(original.STRIPE_SECRET_KEY);
const url = `${origin}/api/payment/webhook`;
const events = ['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired','invoice.paid','invoice.payment_failed','customer.subscription.updated','customer.subscription.deleted'];
let webhook = (await stripe.webhookEndpoints.list({ limit: 100 })).data.find(x => x.url === url);
if (!webhook) {
  webhook = await stripe.webhookEndpoints.create({ url, enabled_events: events, description: 'Learning Guide isolated UAT; sandbox only' });
  secret('STRIPE_WEBHOOK_SECRET', webhook.secret);
} else {
  await stripe.webhookEndpoints.update(webhook.id, { enabled_events: events });
  const saved = optional('secretsmanager', 'describe-secret', { SecretId: 'learning-guide/uat/stripe_webhook_secret' });
  if (!saved) throw new Error('Existing webhook has no stored signing secret; rotate it before deployment');
  secretArns.STRIPE_WEBHOOK_SECRET = saved.ARN;
}

if (process.argv.includes('--bootstrap')) {
  const roleName = 'learning-guide-uat-bootstrap';
  const role = optional('iam', 'get-role', { RoleName: roleName })?.Role || aws('iam', 'create-role', { RoleName: roleName, AssumeRolePolicyDocument: JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }] }) }).Role;
  aws('iam', 'attach-role-policy', { RoleName: roleName, PolicyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole' });
  aws('iam', 'put-role-policy', { RoleName: roleName, PolicyName: 'bootstrap-secrets', PolicyDocument: JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 'secretsmanager:GetSecretValue', Resource: [out.MasterSecret, secretArns.DATABASE_URL] }] }) });
  const temp = mkdtempSync(path.join(tmpdir(), 'lg-uat-'));
  try {
    cpSync('deploy/uat-bootstrap.cjs', path.join(temp, 'index.cjs'));
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
    const FunctionName = 'learning-guide-uat-bootstrap';
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
    // Import curriculum from SIT via a temporary VPC Lambda (laptop cannot reach private RDS).
    const sitStack = aws('cloudformation', 'describe-stacks', { StackName: 'learning-guide-sit' }).Stacks[0];
    const sitOut = Object.fromEntries(sitStack.Outputs.map(x => [x.OutputKey, x.OutputValue]));
    const sitDbSecret = optional('secretsmanager', 'describe-secret', { SecretId: 'learning-guide/sit/database_url' });
    if (!sitDbSecret) throw new Error('SIT DATABASE_URL secret is required to seed UAT curriculum');
    const exportTemp = mkdtempSync(path.join(tmpdir(), 'lg-uat-export-'));
    let product;
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
    const payload = JSON.stringify({ product });
    writeFileSync(path.join(temp, 'payload.json'), payload, { mode: 0o600 });
    const resultFile = path.join(temp, 'result.json');
    const response = JSON.parse(execFileSync('aws', ['lambda','invoke','--region',region,'--function-name',FunctionName,'--cli-binary-format','raw-in-base64-out','--payload',`file://${path.join(temp, 'payload.json')}`,resultFile], { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }));
    const result = JSON.parse(readFileSync(resultFile, 'utf8'));
    if (response.FunctionError || !result.ok) throw new Error(`Database bootstrap failed: ${result.errorType || 'see restricted Lambda logs'}`);
    console.log(JSON.stringify({ database: result, courses: Array.isArray(product.courses) ? product.courses.length : 0 }));
    aws('lambda', 'delete-function', { FunctionName });
    aws('iam', 'delete-role-policy', { RoleName: roleName, PolicyName: 'bootstrap-secrets' });
    aws('iam', 'detach-role-policy', { RoleName: roleName, PolicyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole' });
  } finally { rmSync(temp, { recursive: true, force: true }); }
  const marker = Buffer.from('Learning Guide UAT storage readiness');
  aws('s3api', 'put-object', { Bucket: out.BucketName, Key: 'learning-guide/uat/.deployment-ready' });
  console.log(JSON.stringify({ storage: out.BucketName, marker: marker.length, webhook: webhook.id, events: events.length }));
}

if (process.argv.includes('--deploy')) {
  const sha = execFileSync('git', ['rev-parse','HEAD'], { encoding: 'utf8' }).trim();
  const branch = process.env.GITHUB_REF_NAME || 'uat';
  const variables = Object.fromEntries(Object.entries(config.RuntimeEnvironmentVariables).filter(([key]) => !/(SECRET|PASSWORD|TOKEN|DATABASE_URL|SMTP_PASS|OPENROUTER_API_KEY|WECHAT_APP_ID|APP_VERSION|APP_ENV|NEXT_PUBLIC_APP_URL|OPENROUTER_SITE_URL|DATA_S3_|STORAGE_BACKEND)/.test(key)));
  Object.assign(variables, {
    APP_ENV: 'UAT', NODE_ENV: 'production', APP_VERSION: sha,
    NEXT_PUBLIC_APP_URL: origin, OPENROUTER_SITE_URL: origin,
    DATA_S3_BUCKET: out.BucketName, DATA_S3_PREFIX: 'learning-guide/uat', STORAGE_BACKEND: 'postgresql',
    DATABASE_CA_FILE: 'deploy/rds-ap-southeast-1.pem', PAYMENT_MODE: 'stripe', STRIPE_SANDBOX: '1',
    LOCAL_SOCIAL_LOGIN: '0', EMAIL_VERIFICATION_REQUIRED: '1',
    SMTP_HOST: original.SMTP_HOST, SMTP_USER: original.SMTP_USER,
    SMTP_PORT: original.SMTP_PORT || '465', SMTP_SECURE: original.SMTP_SECURE || '1',
    SMTP_FROM: original.SMTP_FROM || original.SMTP_USER
  });
  // Ensure every secret key used by SIT is present for UAT when available.
  for (const key of Object.keys(config.RuntimeEnvironmentSecrets || {})) {
    if (!secretArns[key]) {
      const Name = `learning-guide/uat/${key.toLowerCase()}`;
      const existing = optional('secretsmanager', 'describe-secret', { SecretId: Name });
      if (existing) secretArns[key] = existing.ARN;
    }
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
  const existing = services.find(x => x.ServiceName === 'learning-guide-uat');
  const common = {
    SourceConfiguration: sourceConfig,
    InstanceConfiguration: { Cpu: '1024', Memory: '2048', InstanceRoleArn: out.AppRoleArn },
    HealthCheckConfiguration: { Protocol: 'HTTP', Path: '/api/health', Interval: 20, Timeout: 20, HealthyThreshold: 1, UnhealthyThreshold: 5 },
    AutoScalingConfigurationArn: out.ScalingArn,
    NetworkConfiguration: { EgressConfiguration: { EgressType: 'VPC', VpcConnectorArn: out.ConnectorArn }, IngressConfiguration: { IsPubliclyAccessible: true } }
  };
  const response = existing
    ? aws('apprunner','update-service', { ServiceArn: existing.ServiceArn, ...common })
    : aws('apprunner','create-service', { ServiceName: 'learning-guide-uat', ...common, Tags: [{ Key: 'Project', Value: 'LearningGuide' }, { Key: 'Environment', Value: 'UAT' }] });
  console.log(JSON.stringify({ arn: response.Service.ServiceArn, url: response.Service.ServiceUrl, operation: response.OperationId, version: sha, branch }));
}
