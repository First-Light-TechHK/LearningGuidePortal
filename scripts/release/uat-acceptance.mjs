import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { aws } from './aws.mjs';
import { privateTask } from './private-task.mjs';
import { curriculumManifest, compareCurricula, digest } from './curriculum.mjs';
import { checkRequiredCI } from './required-ci.mjs';
import { verifyCourseBrowser } from './course-browser.mjs';
import { runLiveSmoke } from './liveSmoke.mjs';
import { releaseEnvironments } from './environments.mjs';

export async function captureCurriculum(environment) {
  const origin = releaseEnvironments[environment.toUpperCase()].origin;
  const health = await (await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(30000) })).json();
  const manifest = await privateTask(environment, 'deploy/export-curriculum.cjs', async invoke => curriculumManifest((await invoke()).product));
  return { ...manifest, provenance: { environment: environment.toUpperCase(), origin, deployment: health.version, capturedAt: new Date().toISOString(), basis: 'Published SIT curriculum, as requested by the user; not final business sign-off' } };
}

export function assetInventory(manifest) {
  const pins = JSON.parse(readFileSync(new URL('../../deploy/uat-course-media.json', import.meta.url), 'utf8')).objects;
  const urls = [...new Set(manifest.courses.flatMap(course => course.media.map(asset => asset.url)))].sort();
  return urls.map(value => {
    const url = new URL(value);
    const match = url.hostname.match(/^([a-z0-9.-]+)\.s3\.ap-southeast-1\.amazonaws\.com$/);
    if (!match || !['aitutor-data-851987565851', 'learning-guide-uat-851987565851', 'learning-guide-sit-851987565851'].includes(match[1])) throw new Error(`Undeclared curriculum media origin: ${url.origin}`);
    const object = aws('s3api', 'head-object', { Bucket: match[1], Key: decodeURIComponent(url.pathname.slice(1)), ChecksumMode: 'ENABLED' });
    const pin = pins.find(item => item.bucket === match[1] && item.key === decodeURIComponent(url.pathname.slice(1)));
    if (!pin || pin.version !== object.VersionId || pin.etag !== object.ETag || pin.bytes !== object.ContentLength) throw new Error(`SIT media differs from the pinned UAT release: ${url.pathname}`);
    if (!object.ContentLength || !object.ContentType || /text\/html|application\/xml/.test(object.ContentType)) throw new Error(`Invalid media object: ${url.pathname}`);
    return { resource: digest(value), bucket: match[1], key: decodeURIComponent(url.pathname.slice(1)), bytes: object.ContentLength, contentType: object.ContentType, etag: object.ETag, version: object.VersionId || null, checksum: object.ChecksumSHA256 || object.ChecksumCRC32C || object.ChecksumCRC32 || null };
  });
}

export async function verifyUatAcceptance({ sha, outputDir = 'test-results/uat-acceptance', reference } = {}) {
  const receipt = { schema: 'lg-uat-acceptance/v1', sha, startedAt: new Date().toISOString(), ok: false, failures: [], evidence: {}, exclusions: ['External provider sign-in completion, delivery to an email inbox and Stripe settlement are separate acceptance suites; this receipt does not certify them.'] };
  mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  const file = path.resolve(outputDir, 'receipt.json');
  const persist = () => writeFileSync(file, JSON.stringify(receipt, null, 2), { mode: 0o600 });
  const stage = async (name, action) => {
    try {
      const result = await action(); receipt.evidence[name] = result;
      if (result?.ok === false) receipt.failures.push(`${name}: ${JSON.stringify(result.failures)}`);
      persist(); return result;
    } catch (error) { receipt.failures.push(`${name}: ${error.message}`); persist(); return null; }
  };
  try {
    await stage('requiredCI', () => checkRequiredCI({ sha, branch: 'uat' }));
    const sit = reference || await stage('sitReference', () => captureCurriculum('sit'));
    if (reference) receipt.evidence.sitReference = reference;
    const uat = await stage('uatCatalogue', () => captureCurriculum('uat'));
    if (sit && uat) await stage('catalogueParity', () => compareCurricula(sit, uat));
    const assets = sit ? await stage('mediaObjects', () => assetInventory(sit)) : null;
    await stage('infrastructure', () => {
      const stack = aws('cloudformation', 'describe-stacks', { StackName: 'learning-guide-uat' }).Stacks[0];
      if (!['CREATE_COMPLETE', 'UPDATE_COMPLETE'].includes(stack.StackStatus)) throw new Error(`Infrastructure not stable: ${stack.StackStatus}`);
      return { stack: stack.StackId, state: stack.StackStatus, updatedAt: stack.LastUpdatedTime, templateHash: digest(aws('cloudformation', 'get-template', { StackName: 'learning-guide-uat' }).TemplateBody) };
    });
    await stage('publicAccessAndAuthBoundaries', () => runLiveSmoke({ origin: releaseEnvironments.UAT.origin, adminOrigin: releaseEnvironments.UAT.adminOrigin, appEnv: 'UAT', sha, requireDependencyChecks: true, requireVersionMatch: true, checkMail: false }));
    // A mail failure never prevents learner/course tests. Fixture creation is scoped to this run.
    if (sit && uat) await stage('learnerJourney', () => privateTask('uat', 'deploy/uat-acceptance-fixture.cjs', async invoke => {
      const run = randomBytes(8).toString('hex');
      let attempted = false;
      try {
        attempted = true;
        const fixture = await invoke({ action: 'create', run });
        const browserManifest = structuredClone(sit);
        const pins = JSON.parse(readFileSync(new URL('../../deploy/uat-course-media.json', import.meta.url), 'utf8')).objects;
        const versionFor = value => {
          try { const url = new URL(value); return pins.find(item => url.hostname.startsWith(`${item.bucket}.s3.`) && decodeURIComponent(url.pathname.slice(1)) === item.key)?.version; }
          catch { return undefined; }
        };
        for (const course of browserManifest.courses) {
          course.coverVersion = versionFor(course.cover);
          for (const lesson of course.sections.flatMap(section => section.lessons)) for (const media of lesson.media) media.version = versionFor(media.url);
        }
        return await verifyCourseBrowser({ origin: releaseEnvironments.UAT.origin, manifest: browserManifest, credentials: { ...fixture.credentials.entitled, locked: fixture.credentials.locked }, outputDir });
      } finally { if (attempted) await invoke({ action: 'remove', run }); }
    }));
    else receipt.failures.push('learnerJourney: not run because reference/target export failed');
    if (uat) {
      const latestUat = await stage('uatCatalogueAfter', () => captureCurriculum('uat'));
      if (latestUat && latestUat.hash !== uat.hash) receipt.failures.push('UAT catalogue changed during acceptance; restart with the new target');
    }
    if (sit) {
      const latest = await stage('sitReferenceAfter', () => captureCurriculum('sit'));
      if (latest && latest.hash !== sit.hash) receipt.failures.push('SIT catalogue changed during acceptance; restart with the new reference');
      if (assets) await stage('mediaUnchanged', () => {
        if (digest(assetInventory(sit)) !== digest(assets)) throw new Error('Media objects changed during acceptance');
        return { ok: true, objects: assets.length };
      });
    }
    await stage('releaseIdentityAfter', async () => {
      const response = await fetch(`${releaseEnvironments.UAT.origin}/api/health`, { signal: AbortSignal.timeout(30000) });
      const health = await response.json();
      if (!response.ok || !health.ready || health.version !== sha || health.environment !== 'UAT') throw new Error('Deployed release changed or became unhealthy during acceptance');
      checkRequiredCI({ sha, branch: 'uat' });
      return { version: health.version, environment: health.environment, ready: health.ready };
    });
  } finally {
    receipt.ok = receipt.failures.length === 0;
    receipt.finishedAt = new Date().toISOString(); persist();
  }
  return { ...receipt, receiptFile: file };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await verifyUatAcceptance({ sha: process.env.RELEASE_SHA, outputDir: process.env.RELEASE_EVIDENCE_DIR });
  console.log(JSON.stringify({ ok: result.ok, failures: result.failures, receiptFile: result.receiptFile }));
  process.exitCode = result.ok ? 0 : 1;
}
