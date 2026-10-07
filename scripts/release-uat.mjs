import { execFileSync } from 'node:child_process';
import { buildService } from './release/build-branch.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkRequiredCI } from './release/required-ci.mjs';
import { captureCurriculum, assetInventory, verifyUatAcceptance } from './release/uat-acceptance.mjs';
import { readReleaseHealth } from './release/health-read.mjs';

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
if (branch !== 'uat') throw new Error('UAT releases must use the uat branch');
if (execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim()) throw new Error('Commit and verify tracked changes before releasing');
checkRequiredCI({ sha, branch });
if (gh(`repos/${repo}/commits/${encodeURIComponent(branch)}`).sha !== sha) throw new Error('Branch moved; verify and release the new revision');
const reference = await captureCurriculum('sit');
if (!reference.courses.length) throw new Error('SIT reference is empty');
assetInventory(reference);
const summary = aws('apprunner','list-services').ServiceSummaryList.find(x => x.ServiceName === 'learning-guide-uat');
if (!summary) throw new Error('UAT must be provisioned first');
const current = aws('apprunner','describe-service', { ServiceArn: summary.ServiceArn }).Service;
if (current.Status !== 'RUNNING') throw new Error('Another deployment is in progress; retry after it completes');
const source = current.SourceConfiguration;
if (source.ImageRepository) {
  if (!/^851987565851\.dkr\.ecr\.ap-southeast-1\.amazonaws\.com\/learning-guide-portal@sha256:[a-f0-9]{64}$/.test(process.env.UAT_IMAGE || '')) throw new Error('A digest-pinned UAT_IMAGE is required');
  source.ImageRepository.ImageIdentifier = process.env.UAT_IMAGE;
  source.ImageRepository.ImageConfiguration.RuntimeEnvironmentVariables.APP_VERSION = sha;
} else {
  source.CodeRepository.SourceCodeVersion = { Type: 'BRANCH', Value: branch };
  source.CodeRepository.CodeConfiguration.CodeConfigurationValues.RuntimeEnvironmentVariables.APP_VERSION = sha;
}
source.AutoDeploymentsEnabled = false;
const update = aws('apprunner','update-service', { ServiceArn: summary.ServiceArn, SourceConfiguration: source });
if (!update.OperationId) throw new Error('UAT source configuration update returned no OperationId');
console.log(JSON.stringify({ service: summary.ServiceArn, operation: update.OperationId, sha, branch }));
let complete = false;
for (let i = 0; i < 120; i++) {
  await new Promise(resolve => setTimeout(resolve, 20000));
  const operation = aws('apprunner','list-operations', { ServiceArn: summary.ServiceArn }).OperationSummaryList.find(x => x.Id === update.OperationId);
  if (operation?.Status === 'SUCCEEDED') { complete = true; break; }
  if (operation && /FAILED|ROLLBACK/.test(operation.Status)) throw new Error(`Deployment ${operation.Status}`);
}
if (!complete) throw new Error('Timed out waiting for the deployment');
await buildService(summary.ServiceArn);
if (gh(`repos/${repo}/commits/${encodeURIComponent(branch)}`).sha !== sha) throw new Error('Branch changed during build; release identity cannot be accepted');
const { health } = await readReleaseHealth(`https://${summary.ServiceUrl}`);
if (health.environment !== 'UAT' || health.version !== sha) throw new Error('Deployed readiness or release identity mismatch');
const acceptance = await verifyUatAcceptance({ sha, reference, outputDir: process.env.RELEASE_EVIDENCE_DIR });
console.log(JSON.stringify({ ok: acceptance.ok, health, receiptFile: acceptance.receiptFile, failures: acceptance.failures }));
if (!acceptance.ok) throw new Error('UAT is deployed but NOT accepted. Inspect the retained acceptance receipt. No automatic branch rewrite is performed.');
