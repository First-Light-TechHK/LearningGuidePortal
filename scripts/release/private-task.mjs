import { execFileSync } from 'node:child_process';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { aws } from './aws.mjs';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function privateTask(environment, handler, operation) {
  if (!['sit', 'uat'].includes(environment)) throw new Error('Private acceptance tasks are restricted to SIT/UAT');
  if (aws('sts', 'get-caller-identity').Account !== '851987565851') throw new Error('Wrong AWS account');
  const stack = aws('cloudformation', 'describe-stacks', { StackName: `learning-guide-${environment}` }).Stacks[0];
  const out = Object.fromEntries(stack.Outputs.map(item => [item.OutputKey, item.OutputValue]));
  const secret = `learning-guide/${environment}/database_url`;
  const secretArn = aws('secretsmanager', 'describe-secret', { SecretId: secret }).ARN;
  const name = `lg-acceptance-${environment}-${randomBytes(6).toString('hex')}`;
  const dir = mkdtempSync(path.join(tmpdir(), 'lg-private-task-'));
  let roleCreated = false, attached = false, policyCreated = false, functionCreated = false;
  const cleanupFailures = [];
  try {
    cpSync(handler, path.join(dir, 'index.cjs'));
    cpSync('deploy/rds-ap-southeast-1.pem', path.join(dir, 'ca.pem'));
    const copied = new Set();
    function dependency(name) {
      if (copied.has(name)) return;
      copied.add(name);
      const source = `node_modules/${name}`;
      cpSync(source, path.join(dir, 'node_modules', name), { recursive: true });
      const pkg = JSON.parse(readFileSync(`${source}/package.json`, 'utf8'));
      for (const child of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) dependency(child);
    }
    dependency('pg');
    execFileSync('zip', ['-qr', 'function.zip', 'index.cjs', 'ca.pem', 'node_modules'], { cwd: dir });
    const role = aws('iam', 'create-role', { RoleName: name, AssumeRolePolicyDocument: JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }] }) }).Role;
    roleCreated = true;
    aws('iam', 'attach-role-policy', { RoleName: name, PolicyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole' }); attached = true;
    aws('iam', 'put-role-policy', { RoleName: name, PolicyName: 'database-secret', PolicyDocument: JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 'secretsmanager:GetSecretValue', Resource: secretArn }] }) }); policyCreated = true;
    await wait(15000);
    aws('lambda', 'create-function', { FunctionName: name, Runtime: 'nodejs22.x', Role: role.Arn, Handler: 'index.handler', Timeout: 120, MemorySize: 256, Code: { ZipFile: readFileSync(path.join(dir, 'function.zip')).toString('base64') }, VpcConfig: { SubnetIds: [out.PrivateSubnet], SecurityGroupIds: [out.AppSecurityGroup] }, Environment: { Variables: { APP_SECRET: secret } } }); functionCreated = true;
    let ready = false;
    for (let i = 0; i < 120; i++) {
      const config = aws('lambda', 'get-function-configuration', { FunctionName: name });
      if (config.State === 'Active') { ready = true; break; }
      if (config.State === 'Failed') throw new Error('Private acceptance task could not start');
      await wait(5000);
    }
    if (!ready) throw new Error('Private acceptance task start timed out');
    async function invoke(payload = {}) {
      const file = path.join(dir, 'payload.json');
      const result = path.join(dir, 'result.json');
      writeFileSync(file, JSON.stringify(payload), { mode: 0o600 });
      let response;
      try { response = JSON.parse(execFileSync('aws', ['lambda', 'invoke', '--region', 'ap-southeast-1', '--function-name', name, '--cli-binary-format', 'raw-in-base64-out', '--payload', `file://${file}`, result], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 150000 })); }
      catch { throw new Error('Private acceptance invocation failed (credential output suppressed)'); }
      const body = JSON.parse(readFileSync(result, 'utf8'));
      if (response.FunctionError || !body.ok) throw new Error(`Private acceptance failed: ${body.errorType || 'unknown error'}; inspect restricted Lambda logs`);
      return body;
    }
    return await operation(invoke);
  } finally {
    for (const [enabled, service, action, input] of [
      [functionCreated, 'lambda', 'delete-function', { FunctionName: name }],
      [policyCreated, 'iam', 'delete-role-policy', { RoleName: name, PolicyName: 'database-secret' }],
      [attached, 'iam', 'detach-role-policy', { RoleName: name, PolicyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole' }],
      [roleCreated, 'iam', 'delete-role', { RoleName: name }]
    ]) if (enabled) { try { aws(service, action, input); } catch { cleanupFailures.push(`${service}/${action}:${name}`); } }
    if (functionCreated) { try { aws('logs', 'delete-log-group', { logGroupName: `/aws/lambda/${name}` }); } catch { /* A successful task may not have emitted logs yet. */ } }
    rmSync(dir, { recursive: true, force: true });
    if (cleanupFailures.length) throw new Error(`Temporary acceptance resource cleanup failed: ${cleanupFailures.join(', ')}`);
  }
}
