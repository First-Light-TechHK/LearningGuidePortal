import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repo = 'First-Light-TechHK/LearningGuidePortal';
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const branch = process.env.GITHUB_REF_NAME || execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
const gh = endpoint => JSON.parse(execFileSync('gh', ['api', endpoint], { encoding: 'utf8' }));
function aws(service, operation, input = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'lg-release-'));
  try {
    const file = path.join(dir, 'input.json');
    writeFileSync(file, JSON.stringify(input), { mode: 0o600 });
    return JSON.parse(execFileSync('aws', [service, operation, '--region', 'ap-southeast-1', '--output', 'json', '--cli-input-json', `file://${file}`], { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
if (aws('sts','get-caller-identity').Account !== '851987565851') throw new Error('Wrong AWS account');
const runs = gh(`repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${sha}&per_page=20`).workflow_runs;
if (!runs.some(run => run.head_sha === sha && run.conclusion === 'success')) throw new Error('This exact revision has not passed Verify');
if (gh(`repos/${repo}/commits/${encodeURIComponent(branch)}`).sha !== sha) throw new Error('Branch moved; verify and release the new revision');
const summary = aws('apprunner','list-services').ServiceSummaryList.find(x => x.ServiceName === 'learning-guide-sit');
if (!summary) throw new Error('SIT must be provisioned first');
const current = aws('apprunner','describe-service', { ServiceArn: summary.ServiceArn }).Service;
if (current.Status !== 'RUNNING') throw new Error('Another deployment is in progress; retry after it completes');
const source = current.SourceConfiguration;
if (source.ImageRepository) {
  if (!/^851987565851\.dkr\.ecr\.ap-southeast-1\.amazonaws\.com\/learning-guide-portal@sha256:[a-f0-9]{64}$/.test(process.env.SIT_IMAGE || '')) throw new Error('A digest-pinned SIT_IMAGE is required');
  source.ImageRepository.ImageIdentifier = process.env.SIT_IMAGE;
  source.ImageRepository.ImageConfiguration.RuntimeEnvironmentVariables.APP_VERSION = sha;
} else {
  source.CodeRepository.SourceCodeVersion = { Type: 'BRANCH', Value: branch };
  source.CodeRepository.CodeConfiguration.CodeConfigurationValues.RuntimeEnvironmentVariables.APP_VERSION = sha;
}
source.AutoDeploymentsEnabled = false;
const update = aws('apprunner','update-service', { ServiceArn: summary.ServiceArn, SourceConfiguration: source });
console.log(JSON.stringify({ service: summary.ServiceArn, operation: update.OperationId, sha, branch }));
let complete = false;
for (let i = 0; i < 120; i++) {
  await new Promise(resolve => setTimeout(resolve, 20000));
  const operation = aws('apprunner','list-operations', { ServiceArn: summary.ServiceArn }).OperationSummaryList.find(x => x.Id === update.OperationId);
  if (operation?.Status === 'SUCCEEDED') { complete = true; break; }
  if (operation && /FAILED|ROLLBACK/.test(operation.Status)) throw new Error(`Deployment ${operation.Status}`);
}
if (!complete) throw new Error('Timed out waiting for the deployment');
if (gh(`repos/${repo}/commits/${encodeURIComponent(branch)}`).sha !== sha) throw new Error('Branch changed during build; release identity cannot be accepted');
const response = await fetch(`https://${summary.ServiceUrl}/api/health`);
const health = await response.json();
if (!response.ok || !health.ready || health.environment !== 'SIT' || health.version !== sha) throw new Error('Deployed readiness or release identity mismatch');
console.log(JSON.stringify({ ok: true, health }));
