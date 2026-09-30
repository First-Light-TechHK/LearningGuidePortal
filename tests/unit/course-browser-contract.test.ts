// @ts-nocheck -- the release entry point is intentionally executable plain ESM.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mediaIdentity, routeMatches, lessonIdentityMatches, trialGateStateMatches, mediaCoverageFailures, validateBrowserInput, verifyCourseBrowser } from '../../scripts/release/course-browser.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const credentials = {
  email: 'entitled@example.test', password: 'synthetic-entitled-password',
  locked: { email: 'locked@example.test', password: 'synthetic-locked-password' },
};
const makeManifest = () => ({ courses: [{
  id: 'fixture-course', slug: 'fixture-course-alias', title: 'Acceptance course', category: 'Science', cover: '/cover.svg',
  sections: [{ id: 'section-one', title: 'First section', lessons: [
    { id: 'intro', title: 'Introductory lesson', isPublic: true, bodyHash: hash('intro'), contentsHash: hash('[]'), media: [] },
    { id: 'private-lesson', title: 'Private lesson', isPublic: false, bodyHash: hash('body'), contentsHash: hash('contents'), media: [{ url: '/sample.wav', kind: 'audio' }] },
  ] }],
}] });

test('no HTTP-200 login, pricing, cross-host, wrong locale or wrong lesson route can pass', () => {
  const origin = 'https://uat.example.test', path = '/en-GB/account/learn/course?lessonId=two';
  assert.equal(routeMatches(origin + path, path, origin), true);
  for (const actual of [origin + '/en-GB/portal/sign-in', origin + '/en-GB/pricing', 'https://sit.example.test' + path,
    origin + path.replace('two', 'one'), origin + path.replace('en-GB', 'zh-CN'), origin + path + '&error=failed']) {
    assert.equal(routeMatches(actual, path, origin), false);
  }
});

test('lesson identity must match the DOM course id, lesson id and visible title', () => {
  const course = makeManifest().courses[0], lesson = course.sections[0].lessons[1];
  const actual = { courseId: course.id, lessonId: lesson.id, title: lesson.title };
  assert.equal(lessonIdentityMatches(actual, course, lesson), true);
  for (const field of ['courseId', 'lessonId', 'title']) assert.equal(lessonIdentityMatches({ ...actual, [field]: 'wrong' }, course, lesson), false);
});

test('preview gate requires a visible upsell, paused playback and the exact 60-second boundary', () => {
  const good = { visible: true, paused: true, currentTime: 60, upgradeHref: '/en-GB/pricing?courseId=fixture-course' };
  assert.equal(trialGateStateMatches(good), true);
  for (const patch of [{ visible: false }, { paused: false }, { currentTime: 30 }, { currentTime: 61 }, { currentTime: NaN }, { upgradeHref: '/en-GB/portal/sign-in' }]) {
    assert.equal(trialGateStateMatches({ ...good, ...patch }), false);
  }
});

test('missing fixtures/manifests, duplicate identities and missing content hashes fail closed', async () => {
  const input = { origin: 'https://uat.example.test', manifest: makeManifest(), credentials, outputDir: '/tmp/unused-browser-contract' };
  assert.deepEqual(validateBrowserInput(input), []);
  assert.ok(validateBrowserInput({ ...input, credentials: undefined }).includes('student_fixture_required'));
  assert.ok(validateBrowserInput({ ...input, manifest: { courses: [] } }).includes('reference_manifest_required'));
  const duplicate = makeManifest(); duplicate.courses.push(duplicate.courses[0]);
  assert.ok(validateBrowserInput({ ...input, manifest: duplicate }).some(value => value.endsWith('duplicate_identity')));
  const invalid = makeManifest(); delete invalid.courses[0].sections[0].lessons[0].contentsHash;
  assert.ok(validateBrowserInput({ ...input, manifest: invalid }).some(value => value.endsWith('invalid_lesson')));
  // No browser/network activity occurs before a fixture is explicitly supplied.
  const result = await verifyCourseBrowser({ ...input, credentials: undefined });
  assert.equal(result.ok, false); assert.equal(result.evidence.checks.length, 0);
});

test('logical media identity discards signatures while physical version checks reject replacements', () => {
  const origin = 'https://uat.example.test';
  const signed = 'https://bucket.s3.amazonaws.com/course/a.png?X-Amz-Signature=SECRET&X-Amz-Credential=TOKEN&versionId=one';
  assert.equal(mediaIdentity(signed, origin), 'https://bucket.s3.amazonaws.com/course/a.png');
  const regional = 'https://bucket.s3.ap-southeast-1.amazonaws.com/course/a.png';
  assert.equal(mediaIdentity(`${regional}?versionId=one&x-id=GetObject&X-Amz-Signature=SECRET`, origin), regional);
  assert.equal(mediaIdentity(`${origin}/media?x-id=GetObject`, origin), '/media?x-id=GetObject');
  assert.equal(mediaIdentity('/_next/image?url=%2Fcover.svg&w=800&q=75', origin), '/cover.svg');
  assert.equal(mediaIdentity(signed, origin), mediaIdentity(signed.replace('versionId=one', 'versionId=two'), origin));
  const expected = [{ kind: 'image', url: signed, version: 'one' }];
  const observed = [{ kind: 'image', identity: mediaIdentity(signed, origin), version: 'two', ok: true }];
  assert.equal(mediaCoverageFailures(expected, observed, origin).length, 1);
  assert.deepEqual(mediaCoverageFailures(expected, [{ ...observed[0], version: 'one' }], origin), []);
  assert.equal(mediaIdentity('javascript:alert(1)', origin), null);
  assert.deepEqual(mediaCoverageFailures([{ kind: 'image', url: '/correct.svg' }], [{ kind: 'image', identity: '/fallback.svg', ok: true }], origin), ['media_1_not_rendered_and_verified']);
  assert.equal(mediaCoverageFailures([{ kind: 'audio', url: '/sample.wav' }], [{ kind: 'audio', identity: '/sample.wav', ok: false }], origin).length, 1);
});

function wav() {
  const rate = 8000, samples = rate * 8, data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF', 0); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(Math.sin(i * Math.PI * 440 / rate) * 500), 44 + i * 2);
  return data;
}

// Disposable HTTP fixture, not the application or any SIT/UAT account. Real
// Chromium decodes images and WAV data and exercises the acceptance contract.
async function fixture(t, faults = {}) {
  const manifest = makeManifest(), course = manifest.courses[0], lessons = course.sections[0].lessons;
  const requests = [], audio = wav();
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://fixture.local');
    requests.push({ path: url.pathname, method: request.method });
    const send = (body, type = 'text/html', status = 200) => { response.writeHead(status, { 'Content-Type': type }); response.end(body); };
    const json = body => send(JSON.stringify(body), 'application/json');
    const kind = request.headers.cookie?.includes('fixture=entitled') ? 'entitled' : request.headers.cookie?.includes('fixture=locked') ? 'locked' : null;
    if (url.pathname === '/api/auth/login') {
      let raw = ''; for await (const chunk of request) raw += chunk;
      const input = JSON.parse(raw), entitled = input.email === credentials.email;
      if (input.password !== (entitled ? credentials.password : credentials.locked.password)) return send('{}', 'application/json', 401);
      response.setHeader('Set-Cookie', `fixture=${entitled ? 'entitled' : 'locked'}; HttpOnly; SameSite=Lax; Path=/`);
      return json({ ok: true, data: { user: { role: 'student' } } });
    }
    if (url.pathname === '/api/auth/me') return json({ ok: true, user: kind ? { role: 'student', email: kind === 'entitled' ? credentials.email : credentials.locked.email } : null });
    if (url.pathname === '/api/entitlements/check') return json({ ok: true, entitlement: { allowed: kind === 'entitled' } });
    if (url.pathname === '/cover.svg') {
      if (faults.cover) return send('forbidden SECRET_SIGNED_URL', 'text/plain', 403);
      return send('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="50"><rect width="80" height="50" fill="teal"/></svg>', 'image/svg+xml');
    }
    if (url.pathname === '/sample.wav') {
      if (faults.audio === 'invalid') return send('not actually audio', 'audio/wav');
      if (faults.audio) return send('expired SIGNATURE_SECRET', 'text/plain', 403);
      const match = /bytes=(\d+)-(\d*)/.exec(request.headers.range || '');
      if (match) {
        const start = Number(match[1]), end = Math.min(audio.length - 1, match[2] ? Number(match[2]) : audio.length - 1);
        response.writeHead(206, { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${audio.length}`, 'Content-Length': end - start + 1 });
        return response.end(audio.subarray(start, end + 1));
      }
      response.setHeader('Accept-Ranges', 'bytes'); response.setHeader('Content-Length', audio.length);
      return send(audio, 'audio/wav');
    }
    const locale = url.pathname.split('/')[1], base = `/${locale}/portal/courses`, detail = `${base}/${course.id}`;
    const image = '<img class="course-thumbnail" alt="Acceptance course" loading="lazy" width="80" height="50" src="/cover.svg?X-Amz-Signature=SIGNATURE_SECRET">';
    const doc = body => send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:sans-serif} main{max-width:800px} audio{max-width:100%} dialog{background:white} .la-modal-body{padding:10px}</style></head><body>${body}</body></html>`);
    if (url.pathname === base) return doc(`<main><h1>Courses</h1><nav class="portal-category-filter"><a href="${base}?category=Science">${locale === 'zh-CN' ? '科学' : 'Science'}</a></nav><div style="height:950px"></div><article class="portal-course-card"><a href="${detail}">${image}<h3>${course.title}</h3><span class="portal-course-category">${locale === 'zh-CN' ? '科学' : 'Science'}</span></a></article></main>`);
    if ([detail, `${base}/${course.slug}`].includes(url.pathname)) return doc(`<main data-page-state="available"><h1 data-course-title="${course.title}">${course.title}</h1><p data-course-track="Science">Science</p>${image}<section data-syllabus="true">${lessons.map(lesson => `<article data-lesson-id="${lesson.id}"><h3><span>Lesson 1</span>${lesson.title}</h3></article>`).join('')}</section><a data-course-secondary-cta="view_plans" href="/${locale}/pricing?courseId=${course.id}">View plans</a></main>`);
    const learning = url.pathname.includes('/account/learn/'), preview = url.pathname.endsWith('/public-lesson');
    if (learning && kind === 'locked' && !faults.leak) { response.writeHead(307, { Location: detail }); return response.end(); }
    if (learning && faults.redirect) { response.writeHead(307, { Location: `/${locale}/portal/sign-in` }); return response.end(); }
    if (url.pathname.endsWith('/sign-in')) return doc('<main><h1>Sign in</h1></main>');
    if (preview || learning) {
      const lesson = lessons.find(item => item.id === url.searchParams.get('lessonId')) || lessons[0];
      const lessonId = faults.identity && learning ? 'incorrect-id' : lesson.id;
      const content = faults.blank ? '' : 'Verified visible source lesson content.';
      const body = lesson.isPublic || faults.blank ? `<div class="lesson-body">${content}</div>` : `<section class="la-content-player"><h3>Audio exhibit</h3><div class="la-prose">${content}</div><div class="la-node-links"><button onclick="document.querySelector('dialog').showModal()">Hear the source</button></div></section>`;
      const modal = lesson.isPublic ? '' : `<dialog class="la-modal"><header><h3>Source recording</h3><button onclick="this.closest('dialog').close()">Close</button></header><div class="la-modal-body"><audio controls preload="metadata" src="/sample.wav?X-Amz-Signature=SIGNATURE_SECRET"></audio></div></dialog>`;
      return doc(`<main data-course-id="${course.id}" data-lesson-id="${lessonId}"><aside class="lesson-nav"><p class="portal-eyebrow">${course.title}</p>${lessons.map(item => `<a class="${item.id === lesson.id ? 'active' : ''}" href="/${locale}/account/learn/${course.id}?lessonId=${item.id}">${item.title}</a>`).join('')}</aside><article class="lesson-content"><h1>${lesson.title}</h1>${body}</article></main>${modal}${faults.pageerror ? '<script>throw new Error("PASSWORD_SECRET https://s3.example/?X-Amz-Signature=SIGNATURE_SECRET")</script>' : ''}`);
    }
    return send('not found', 'text/plain', 404);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const outputDir = await mkdtemp(join(tmpdir(), 'lg-course-browser-test-'));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(outputDir, { recursive: true, force: true }); });
  return { manifest, origin: `http://127.0.0.1:${server.address().port}`, outputDir, requests };
}

test('Chromium acceptance covers both locales, every lesson, locked routes, lazy covers and real audio playback', { timeout: 60_000 }, async t => {
  const f = await fixture(t);
  const result = await verifyCourseBrowser({ ...f, credentials });
  assert.deepEqual(result.failures, []);
  assert.equal(result.ok, true);
  assert.equal(result.evidence.coverage.lessons, 4);
  assert.equal(result.evidence.screenshots.length, 4);
  const mediaChecks = result.evidence.checks.filter(check => check.metrics?.verifiedMedia?.some(media => media.kind === 'audio'));
  assert.equal(mediaChecks.length, 2);
  assert.ok(mediaChecks.every(check => check.metrics.verifiedMedia.some(media => media.playedSeconds > 0 && media.seekSeconds > 0)));
  for (const path of result.evidence.screenshots) assert.ok((await readFile(path)).length > 100);
  const record = await readFile(join(result.evidence.screenshots[0], '..', 'result.json'), 'utf8');
  for (const secret of [credentials.email, credentials.password, credentials.locked.email, credentials.locked.password, 'SIGNATURE_SECRET', 'Set-Cookie', 'X-Amz-Signature']) assert.ok(!record.includes(secret));
  assert.ok(f.requests.every(request => request.method === 'GET' || request.path === '/api/auth/login'));
});

test('browser detects actual sign-in redirects and continues through both locales', { timeout: 60_000 }, async t => {
  const f = await fixture(t, { redirect: true });
  const result = await verifyCourseBrowser({ ...f, credentials });
  assert.equal(result.ok, false);
  assert.equal(result.failures.filter(failure => failure.code === 'unexpected_final_route').length, 4);
  assert.ok(result.evidence.checks.some(check => check.scope.startsWith('zh-CN/')));
});

test('wrong lesson identity, denied images and request errors are failures without leaking secret-bearing messages', { timeout: 60_000 }, async t => {
  const f = await fixture(t, { identity: true, cover: true, pageerror: true });
  const result = await verifyCourseBrowser({ ...f, credentials });
  assert.equal(result.ok, false);
  for (const code of ['lesson_identity_mismatch', 'image_decode_failed', 'resource_http_error', 'uncaught_page_error']) assert.ok(result.failures.some(failure => failure.code === code), code);
  const serialised = JSON.stringify(result);
  for (const secret of ['PASSWORD_SECRET', 'SIGNATURE_SECRET', credentials.password, credentials.email, 'X-Amz-Signature']) assert.ok(!serialised.includes(secret));
});

test('a visible heading cannot conceal an empty text lesson or unauthorised full-course rendering', { timeout: 60_000 }, async t => {
  const f = await fixture(t, { blank: true, leak: true });
  const result = await verifyCourseBrowser({ ...f, credentials });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some(failure => failure.code === 'empty_lesson_content'));
  assert.ok(result.failures.some(failure => failure.code === 'locked_lesson_not_denied_to_course_upsell'));
});

test('missing locked fixture is reported rather than silently skipping access-boundary acceptance', { timeout: 60_000 }, async t => {
  const f = await fixture(t);
  const result = await verifyCourseBrowser({ ...f, credentials: { email: credentials.email, password: credentials.password } });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some(failure => failure.code === 'separate_non_entitled_fixture_required'));
});

test('HTTP-200 media bytes that Chromium cannot decode do not count as playback', { timeout: 60_000 }, async t => {
  const f = await fixture(t, { audio: 'invalid' });
  const result = await verifyCourseBrowser({ ...f, credentials });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some(failure => failure.code === 'media_decode_failed'));
  assert.ok(result.failures.some(failure => failure.code === 'media_1_not_rendered_and_verified'));
});
