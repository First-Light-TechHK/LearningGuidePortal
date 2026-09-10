// Operator-only setup. Secrets use protected temporary files, never logs or Git.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, mkdtempSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import Stripe from 'stripe';

const region = 'ap-southeast-1';
const oldArn = 'arn:aws:apprunner:ap-southeast-1:851987565851:service/learning-guide-portal/73f7ec76f1884c5f936544916a2607ad';
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
const stack = aws('cloudformation', 'describe-stacks', { StackName: 'learning-guide-sit' }).Stacks[0];
if (!['CREATE_COMPLETE', 'UPDATE_COMPLETE'].includes(stack.StackStatus)) throw new Error(`Infrastructure not ready: ${stack.StackStatus}`);
const out = Object.fromEntries(stack.Outputs.map(x => [x.OutputKey, x.OutputValue]));
const source = aws('apprunner', 'describe-service', { ServiceArn: oldArn }).Service;
const config = source.SourceConfiguration.CodeRepository.CodeConfiguration.CodeConfigurationValues;
const original = { ...config.RuntimeEnvironmentVariables };
for (const [key, arn] of Object.entries(config.RuntimeEnvironmentSecrets || {})) original[key] = aws('secretsmanager', 'get-secret-value', { SecretId: arn }).SecretString;
const secretArns = {};
function secret(key, value) {
  const Name = `learning-guide/sit/${key.toLowerCase()}`;
  const existing = optional('secretsmanager', 'describe-secret', { SecretId: Name });
  if (!existing) secretArns[key] = aws('secretsmanager', 'create-secret', { Name, SecretString: value, Tags: [{ Key: 'Environment', Value: 'SIT' }] }).ARN;
  else secretArns[key] = existing.ARN;
  return aws('secretsmanager', 'get-secret-value', { SecretId: secretArns[key] }).SecretString;
}
secret('DATABASE_URL', `postgresql://lg_sit_app:${randomBytes(32).toString('hex')}@${out.DatabaseHost}:5432/learning_guide_sit`);
secret('SESSION_SECRET', randomBytes(48).toString('hex'));
for (const key of ['GOOGLE_CLIENT_SECRET','WECHAT_APP_ID','WECHAT_APP_SECRET','OPENROUTER_API_KEY','STRIPE_SECRET_KEY']) {
  if (!original[key]) throw new Error(`Source credential missing: ${key}`);
  secret(key, original[key]);
}
if (!original.STRIPE_SECRET_KEY.startsWith('sk_test_')) throw new Error('SIT refuses live Stripe keys');
const stripe = new Stripe(original.STRIPE_SECRET_KEY);
const url = 'https://sit.ilovelearningguide.com/api/payment/webhook';
const events = ['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired','invoice.paid','invoice.payment_failed','customer.subscription.updated','customer.subscription.deleted'];
let webhook = (await stripe.webhookEndpoints.list({ limit: 100 })).data.find(x => x.url === url);
if (!webhook) {
  webhook = await stripe.webhookEndpoints.create({ url, enabled_events: events, description: 'Learning Guide isolated SIT; sandbox only' });
  secret('STRIPE_WEBHOOK_SECRET', webhook.secret);
} else {
  await stripe.webhookEndpoints.update(webhook.id, { enabled_events: events });
  const saved = optional('secretsmanager', 'describe-secret', { SecretId: 'learning-guide/sit/stripe_webhook_secret' });
  if (!saved) throw new Error('Existing webhook has no stored signing secret; rotate it before deployment');
  secretArns.STRIPE_WEBHOOK_SECRET = saved.ARN;
}

if (process.argv.includes('--bootstrap')) {
  const roleName = 'learning-guide-sit-bootstrap';
  const role = optional('iam', 'get-role', { RoleName: roleName })?.Role || aws('iam', 'create-role', { RoleName: roleName, AssumeRolePolicyDocument: JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }] }) }).Role;
  aws('iam', 'attach-role-policy', { RoleName: roleName, PolicyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole' });
  aws('iam', 'put-role-policy', { RoleName: roleName, PolicyName: 'bootstrap-secrets', PolicyDocument: JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 'secretsmanager:GetSecretValue', Resource: [out.MasterSecret, secretArns.DATABASE_URL] }] }) });
  const temp = mkdtempSync(path.join(tmpdir(), 'lg-sit-'));
  try {
    cpSync('deploy/sit-bootstrap.cjs', path.join(temp, 'index.cjs'));
    cpSync('deploy/rds-ap-southeast-1.pem', path.join(temp, 'ca.pem'));
    cpSync('db/migrations/009_product_payment_keys.sql', path.join(temp, '009_product_payment_keys.sql'));
    const copied = new Set();
    function copyDependency(name) {
      if (copied.has(name)) return;
      copied.add(name);
      const source = `node_modules/${name}`;
      cpSync(source, path.join(temp, 'node_modules', name), { recursive: true });
      const manifest = JSON.parse(readFileSync(`${source}/package.json`, 'utf8'));
      for (const dependency of Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies })) copyDependency(dependency);
    }
    copyDependency('pg');
    execFileSync('zip', ['-qr', 'function.zip', 'index.cjs', 'ca.pem', '009_product_payment_keys.sql', 'node_modules'], { cwd: temp });
    const FunctionName = 'learning-guide-sit-bootstrap';
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
    // Import curriculum only. Never copy learner identities, sessions or transactions.
    const db = new pg.Client({ connectionString: original.DATABASE_URL, ssl: { rejectUnauthorized: true, ca: readFileSync('deploy/rds-ap-southeast-1.pem', 'utf8') } });
    await db.connect();
    let product;
    try {
      const result = await db.query("SELECT content FROM app_files WHERE path = 'learning_guide/product.json'");
      const data = result.rowCount ? JSON.parse(result.rows[0].content) : {};
      product = Object.fromEntries(['version','courses','plans','portalContent'].filter(k => k in data).map(k => [k, data[k]]));
    } finally { await db.end(); }
    const payload = JSON.stringify({ product });
    writeFileSync(path.join(temp, 'payload.json'), payload, { mode: 0o600 });
    const resultFile = path.join(temp, 'result.json');
    const response = JSON.parse(execFileSync('aws', ['lambda','invoke','--region',region,'--function-name',FunctionName,'--cli-binary-format','raw-in-base64-out','--payload',`file://${path.join(temp, 'payload.json')}`,resultFile], { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }));
    const result = JSON.parse(readFileSync(resultFile, 'utf8'));
    if (response.FunctionError || !result.ok) throw new Error(`Database bootstrap failed: ${result.errorType || 'see restricted Lambda logs'}`);
    console.log(JSON.stringify({ database: result }));
    aws('lambda', 'delete-function', { FunctionName });
    aws('iam', 'delete-role-policy', { RoleName: roleName, PolicyName: 'bootstrap-secrets' });
    aws('iam', 'detach-role-policy', { RoleName: roleName, PolicyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole' });
    // Lambda may retain the role briefly while ENIs are removed; it has no secret access now.
  } finally { rmSync(temp, { recursive: true, force: true }); }
  const marker = Buffer.from('Learning Guide SIT storage readiness');
  aws('s3api', 'put-object', { Bucket: out.BucketName, Key: 'learning-guide/sit/.deployment-ready' });
  console.log(JSON.stringify({ storage: out.BucketName, marker: marker.length, webhook: webhook.id, events: events.length }));
}

if (process.argv.includes('--deploy')) {
  const sha = execFileSync('git', ['rev-parse','HEAD'], { encoding: 'utf8' }).trim();
  const variables = Object.fromEntries(Object.entries(config.RuntimeEnvironmentVariables).filter(([key]) => !/(SECRET|PASSWORD|TOKEN|DATABASE_URL|SMTP_PASS|OPENROUTER_API_KEY|WECHAT_APP_ID)/.test(key)));
  for (const key of Object.keys(variables)) if (key.startsWith('SMTP_')) delete variables[key];
  Object.assign(variables, { APP_ENV: 'SIT', NODE_ENV: 'production', APP_VERSION: sha, NEXT_PUBLIC_APP_URL: 'https://sit.ilovelearningguide.com', OPENROUTER_SITE_URL: 'https://sit.ilovelearningguide.com', DATA_S3_BUCKET: out.BucketName, DATA_S3_PREFIX: 'learning-guide/sit', STORAGE_BACKEND: 'postgresql', DATABASE_CA_FILE: 'deploy/rds-ap-southeast-1.pem', PAYMENT_MODE: 'stripe', STRIPE_SANDBOX: '1', LOCAL_SOCIAL_LOGIN: '0', EMAIL_VERIFICATION_REQUIRED: '1' });
  let sourceConfig = { ...source.SourceConfiguration, AutoDeploymentsEnabled: false, CodeRepository: { ...source.SourceConfiguration.CodeRepository, SourceCodeVersion: { Type: 'BRANCH', Value: 'codex/sit-deployment' }, CodeConfiguration: { ConfigurationSource: 'API', CodeConfigurationValues: { Runtime: 'NODEJS_22', BuildCommand: 'npm ci && npm run build', StartCommand: 'npm run start -- -p 8080', Port: '8080', RuntimeEnvironmentVariables: variables, RuntimeEnvironmentSecrets: secretArns } } } };
  if (process.env.SIT_IMAGE) {
    if (!/^851987565851\.dkr\.ecr\.ap-southeast-1\.amazonaws\.com\/learning-guide-portal@sha256:[a-f0-9]{64}$/.test(process.env.SIT_IMAGE)) throw new Error('SIT image must be pinned to a digest in the approved ECR repository');
    const roleName = 'learning-guide-sit-ecr';
    const role = optional('iam','get-role', { RoleName: roleName })?.Role || aws('iam','create-role', { RoleName: roleName, AssumeRolePolicyDocument: JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'build.apprunner.amazonaws.com' }, Action: 'sts:AssumeRole' }] }) }).Role;
    aws('iam','put-role-policy', { RoleName: roleName, PolicyName: 'read-learning-guide-image', PolicyDocument: JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 'ecr:GetAuthorizationToken', Resource: '*' }, { Effect: 'Allow', Action: ['ecr:BatchCheckLayerAvailability','ecr:GetDownloadUrlForLayer','ecr:BatchGetImage','ecr:DescribeImages'], Resource: 'arn:aws:ecr:ap-southeast-1:851987565851:repository/learning-guide-portal' }] }) });
    await sleep(10000);
    sourceConfig = { AutoDeploymentsEnabled: false, AuthenticationConfiguration: { AccessRoleArn: role.Arn }, ImageRepository: { ImageIdentifier: process.env.SIT_IMAGE, ImageRepositoryType: 'ECR', ImageConfiguration: { Port: '8080', RuntimeEnvironmentVariables: variables, RuntimeEnvironmentSecrets: secretArns } } };
  }
  const services = aws('apprunner','list-services').ServiceSummaryList;
  const existing = services.find(x => x.ServiceName === 'learning-guide-sit');
  const common = { SourceConfiguration: sourceConfig, InstanceConfiguration: { Cpu: '1024', Memory: '2048', InstanceRoleArn: out.AppRoleArn }, HealthCheckConfiguration: { Protocol: 'HTTP', Path: '/api/health', Interval: 20, Timeout: 20, HealthyThreshold: 1, UnhealthyThreshold: 5 }, AutoScalingConfigurationArn: out.ScalingArn, NetworkConfiguration: { EgressConfiguration: { EgressType: 'VPC', VpcConnectorArn: out.ConnectorArn }, IngressConfiguration: { IsPubliclyAccessible: true } } };
  const response = existing ? aws('apprunner','update-service', { ServiceArn: existing.ServiceArn, ...common }) : aws('apprunner','create-service', { ServiceName: 'learning-guide-sit', ...common, Tags: [{ Key: 'Project', Value: 'LearningGuide' }, { Key: 'Environment', Value: 'SIT' }] });
  console.log(JSON.stringify({ arn: response.Service.ServiceArn, url: response.Service.ServiceUrl, operation: response.OperationId, version: sha }));
}
