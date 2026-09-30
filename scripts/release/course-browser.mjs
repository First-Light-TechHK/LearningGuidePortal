import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';

const LOCALES = ['en-GB', 'zh-CN'];
const LIMIT = { navigation: 25_000, resource: 15_000, action: 8_000, lesson: 120_000, course: 900_000 };
const KINDS = new Set(['image', 'video', 'audio', 'pdf', 'model3d']);
const normaliseText = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const digest = value => createHash('sha256').update(String(value)).digest('hex');
const lessonsOf = course => course.sections.flatMap(section => section.lessons);
const selectorValue = value => JSON.stringify(String(value));

class CheckFailure extends Error {
  constructor(code) { super(code); this.code = code; }
}
function requireCheck(condition, code) { if (!condition) throw new CheckFailure(code); }
function remaining(deadline, maximum = LIMIT.action) {
  const ms = Math.min(maximum, deadline - Date.now());
  requireCheck(ms > 0, 'budget_exhausted');
  return ms;
}

// Used only in memory for comparison. Evidence contains hashes, never media URLs.
export function mediaIdentity(value, origin) {
  try {
    let url = new URL(value, origin);
    if (url.pathname === '/_next/image') url = new URL(url.searchParams.get('url'), origin);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    for (const key of [...url.searchParams.keys()]) {
      if (/^(x-amz-|x-goog-|signature$|expires$|awsaccesskeyid$|key-pair-id$|policy$|versionid$)/i.test(key) ||
        (key === 'x-id' && url.searchParams.get(key) === 'GetObject' && /^[a-z0-9.-]+\.s3\.ap-southeast-1\.amazonaws\.com$/.test(url.hostname))) url.searchParams.delete(key);
    }
    url.searchParams.sort(); url.hash = '';
    // Application-relative media can legitimately move from SIT to UAT.
    return (url.origin === new URL(origin).origin ? '' : url.origin) + url.pathname + url.search;
  } catch { return null; }
}

export function routeMatches(actual, expected, origin) {
  try {
    const a = new URL(actual, origin), e = new URL(expected, origin);
    a.searchParams.sort(); e.searchParams.sort();
    return a.origin === new URL(origin).origin && a.origin === e.origin &&
      a.pathname === e.pathname && a.search === e.search && !a.hash && !a.username && !a.password;
  } catch { return false; }
}

export function lessonIdentityMatches(actual, course, lesson) {
  return actual?.courseId === course.id && actual?.lessonId === lesson.id &&
    normaliseText(actual?.title) === normaliseText(lesson.title);
}

export function trialGateStateMatches({ visible, paused, currentTime, upgradeHref }) {
  return visible === true && paused === true && Number.isFinite(currentTime) &&
    currentTime >= 59.8 && currentTime <= 60.05 && typeof upgradeHref === 'string' &&
    /^\/(en-GB|zh-CN)\/pricing\?/.test(upgradeHref);
}

export function mediaCoverageFailures(expected, observed, origin) {
  return expected.flatMap((asset, index) => {
    const key = mediaIdentity(asset.url, origin);
    return !key || !observed.some(item => item.kind === asset.kind && item.identity === key && item.ok === true && (!asset.version || asset.version === item.version))
      ? [`media_${index + 1}_not_rendered_and_verified`] : [];
  });
}

export function validateBrowserInput({ origin, manifest, credentials, outputDir } = {}) {
  const failures = [];
  try {
    const url = new URL(origin);
    if (url.origin !== origin || url.username || url.password ||
      !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error();
  } catch { failures.push('origin_must_be_https_or_localhost_without_path_or_credentials'); }
  if (!credentials || typeof credentials.email !== 'string' || !credentials.email.trim() ||
    typeof credentials.password !== 'string' || !credentials.password) failures.push('student_fixture_required');
  if (typeof outputDir !== 'string' || !outputDir.trim()) failures.push('evidence_directory_required');
  if (!Array.isArray(manifest?.courses) || !manifest.courses.length) return [...failures, 'reference_manifest_required'];
  const ids = new Set(), slugs = new Set();
  const text = value => typeof value === 'string' && value.trim().length > 0;
  for (const [ci, course] of manifest.courses.entries()) {
    const prefix = `manifest_course_${ci + 1}`;
    if (!course || !text(course.id) || !text(course.slug) || !text(course.title) || !text(course.category) ||
      !(course.cover === null || typeof course.cover === 'string') || !Array.isArray(course.sections) || !course.sections.length) {
      failures.push(`${prefix}_invalid`); continue;
    }
    if (ids.has(course.id) || slugs.has(course.slug)) failures.push(`${prefix}_duplicate_identity`);
    ids.add(course.id); slugs.add(course.slug);
    const sections = new Set(), lessons = new Set();
    for (const section of course.sections) {
      if (!section || !text(section.id) || !text(section.title) || sections.has(section.id) ||
        !Array.isArray(section.lessons) || !section.lessons.length) { failures.push(`${prefix}_invalid_section`); continue; }
      sections.add(section.id);
      for (const lesson of section.lessons) {
        if (!lesson || !text(lesson.id) || !text(lesson.title) || lessons.has(lesson.id) ||
          typeof lesson.isPublic !== 'boolean' || !/^[a-f0-9]{64}$/i.test(lesson.bodyHash || '') ||
          !/^[a-f0-9]{64}$/i.test(lesson.contentsHash || '') || !Array.isArray(lesson.media)) {
          failures.push(`${prefix}_invalid_lesson`); continue;
        }
        lessons.add(lesson.id);
        if (lesson.media.some(asset => !asset || !KINDS.has(asset.kind) || !text(asset.url) || !mediaIdentity(asset.url, origin))) {
          failures.push(`${prefix}_invalid_media`);
        }
      }
    }
  }
  return failures;
}

async function checkImage(image, deadline) {
  await image.scrollIntoViewIfNeeded({ timeout: remaining(deadline) });
  requireCheck(await image.isVisible(), 'image_not_visible');
  const result = await image.evaluate(async (element, timeout) => {
    let timer;
    try {
      await Promise.race([element.decode(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error()), timeout); })]);
      return { ok: element.complete && element.naturalWidth > 0 && element.naturalHeight > 0, src: element.currentSrc || element.src };
    } catch { return { ok: false }; } finally { clearTimeout(timer); }
  }, remaining(deadline, LIMIT.resource));
  requireCheck(result.ok, 'image_decode_failed');
  return result.src;
}

// Native media events and decoding are required; a successful range request is insufficient.
export async function probePlayback(media, timeout = LIMIT.resource) {
  // A string keeps the browser function independent of tsx/esbuild's __name
  // helper when this plain-ESM release module is imported by the unit runner.
  return media.evaluate(new Function(`return async (element, budget) => {
    const until = performance.now() + budget;
    const waitFor = async predicate => {
      while (!predicate()) {
        if (element.error) throw new Error('media_decode_failed');
        if (performance.now() >= until) throw new Error('media_timeout');
        await new Promise(resolve => setTimeout(resolve, 40));
      }
    };
    try {
      element.muted = true; element.preload = 'metadata';
      if (element.readyState === 0) element.load();
      await waitFor(() => element.readyState >= 1);
      if (!Number.isFinite(element.duration) || element.duration <= 0.4) return { ok: false, code: 'media_invalid_duration' };
      const start = Math.min(2, element.duration / 8);
      element.currentTime = start;
      await waitFor(() => !element.seeking && Math.abs(element.currentTime - start) < 0.3);
      // Do not await play indefinitely: a disconnected resource can leave its promise pending.
      let rejected = false;
      element.play().catch(() => { rejected = true; });
      await waitFor(() => rejected || element.currentTime >= start + 0.2);
      if (rejected) return { ok: false, code: 'media_play_failed' };
      if (element.tagName === 'VIDEO' && (!element.videoWidth || !element.videoHeight)) return { ok: false, code: 'video_no_decoded_frames' };
      element.pause();
      const target = Math.min(5, element.duration * 0.65);
      element.currentTime = target;
      await waitFor(() => !element.seeking && Math.abs(element.currentTime - target) < 0.3);
      return { ok: true, duration: element.duration, playedSeconds: 0.2, seekSeconds: target, src: element.currentSrc || element.src };
    } catch (error) { return { ok: false, code: error.message === 'media_decode_failed' ? 'media_decode_failed' : 'media_timeout' }; }
    finally { element.pause(); }
  }`)(), timeout);
}

async function assertPage(page, path, origin, deadline) {
  const response = await page.goto(new URL(path, origin).href, { waitUntil: 'domcontentloaded', timeout: remaining(deadline, LIMIT.navigation) });
  requireCheck(response?.status() === 200, 'document_not_http_200');
  requireCheck(routeMatches(page.url(), path, origin), 'unexpected_final_route');
  await page.locator('main').waitFor({ state: 'visible', timeout: remaining(deadline) });
  requireCheck(!await page.locator('[data-course-failed="true"], [data-course-withdrawn="true"], #__next_error__, .next-error-h1').count(), 'rendered_error_page');
  const title = normaliseText(await page.locator('h1').first().textContent({ timeout: remaining(deadline) }));
  requireCheck(!/^(404|500|Application error|Internal Server Error|This page could not be found)/i.test(title), 'rendered_error_page');
}

function auditPage(page, scope, origin, fail) {
  const seen = new Set();
  const pending = new Set();
  let closing = false;
  const resource = request => digest(mediaIdentity(request.url(), origin) || 'invalid');
  const failed = (code, request, status) => fail(scope, code, { resource: resource(request), type: request.resourceType(), ...(status ? { status } : {}) });
  page.on('pageerror', error => {
    const reactCode = error.message.match(/Minified React error #(\d+)/)?.[1];
    if (!closing) fail(scope, 'uncaught_page_error', reactCode ? { reactCode } : {});
  });
  page.on('request', request => { if (!closing) pending.add(request); });
  page.on('requestfinished', request => pending.delete(request));
  page.on('requestfailed', request => {
    pending.delete(request);
    // Deliberate navigation/player teardown aborts are not fetch/decode success.
    // Every expected asset still has to pass its own decode/playback check.
    if (!closing && !/ERR_ABORTED/.test(request.failure()?.errorText || '')) failed('request_failed', request);
  });
  page.on('response', response => {
    if (closing) return;
    if (response.status() >= 400) failed('resource_http_error', response.request(), response.status());
    else if (response.status() >= 200 && response.status() < 300) seen.add(resource(response.request()));
  });
  return {
    seen,
    async settle(deadline) {
      const until = Math.min(deadline, Date.now() + LIMIT.resource);
      // Media range connections may remain open. They have their own bounded probes.
      const critical = () => [...pending].filter(request => ['document', 'script', 'stylesheet', 'font', 'xhr', 'fetch'].includes(request.resourceType()));
      while (critical().length && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 50));
      for (const request of critical()) failed('resource_timeout', request);
    },
    close() { closing = true; }
  };
}

async function visibleText(locator, deadline) {
  await locator.first().waitFor({ state: 'visible', timeout: remaining(deadline) });
  // Rich text is sanitised and mounted by a client effect after the server response.
  await locator.first().page().waitForFunction(element => !!element?.innerText?.trim(), await locator.first().elementHandle(), { timeout: remaining(deadline) });
  return normaliseText(await locator.first().innerText());
}

async function checkLessonIdentity(page, course, lesson, deadline) {
  const root = page.locator('[data-course-id][data-lesson-id]');
  await root.waitFor({ state: 'visible', timeout: remaining(deadline) });
  const actual = { courseId: await root.getAttribute('data-course-id'), lessonId: await root.getAttribute('data-lesson-id'), title: await root.locator('h1').first().innerText() };
  requireCheck(lessonIdentityMatches(actual, course, lesson), 'lesson_identity_mismatch');
  return root;
}

async function checkRenderedContent(page, root, lesson, origin, deadline, observed, audit) {
  requireCheck(!await root.locator('[role="alert"]:visible').count(), 'visible_content_error');
  const prose = root.locator('.lesson-body, .la-prose');
  let readable = await root.evaluate(element => element.matches('.lesson-body, .la-prose') && !!element.innerText.trim());
  for (let i = 0; i < await prose.count(); i++) {
    if (await prose.nth(i).isVisible() && normaliseText(await prose.nth(i).innerText())) readable = true;
  }
  // Scroll-reactive exhibit previews are checked in their persistent open modal.
  const images = root.locator('img:not(.la-exhibit-float img)');
  for (let i = 0; i < await images.count(); i++) {
    const src = await checkImage(images.nth(i), deadline);
    observed.push({ kind: 'image', identity: mediaIdentity(src, origin), version: new URL(src, origin).searchParams.get('versionId'), ok: true });
  }
  const media = root.locator('video, audio');
  for (let i = 0; i < await media.count(); i++) {
    const element = media.nth(i);
    await element.scrollIntoViewIfNeeded({ timeout: remaining(deadline) });
    requireCheck(await element.isVisible(), 'media_not_visible');
    const result = await probePlayback(element, remaining(deadline, LIMIT.resource));
    requireCheck(result.ok, result.code || 'media_playback_failed');
    const kind = await element.evaluate(el => el.tagName.toLowerCase());
    observed.push({ kind, identity: mediaIdentity(result.src, origin), version: new URL(result.src, origin).searchParams.get('versionId'), ok: true, duration: result.duration, playedSeconds: result.playedSeconds, seekSeconds: result.seekSeconds });
  }
  const pdfs = root.locator('.la-pdf');
  for (let i = 0; i < await pdfs.count(); i++) {
    const pdf = pdfs.nth(i);
    await pdf.locator('canvas').waitFor({ state: 'visible', timeout: remaining(deadline, LIMIT.resource) });
    requireCheck(await pdf.getAttribute('data-pdf-state') === 'ready', 'pdf_not_ready');
    requireCheck(await pdf.locator('canvas').evaluate(canvas => canvas.width > 0 && canvas.height > 0), 'pdf_blank_canvas');
    const src = await pdf.locator('a.la-pdf-open').getAttribute('href');
    observed.push({ kind: 'pdf', identity: mediaIdentity(src, origin), ok: true });
  }
  const models = root.locator('.la-model');
  for (let i = 0; i < await models.count(); i++) {
    const model = models.nth(i);
    await model.locator('canvas').waitFor({ state: 'visible', timeout: remaining(deadline, LIMIT.resource) });
    await page.waitForFunction(element => !element.querySelector('.la-model-status') && [...element.querySelectorAll('button')].every(button => !button.disabled), await model.elementHandle(), { timeout: remaining(deadline, LIMIT.resource) });
    const { default: sharp } = await import('sharp');
    const pixels = await sharp(await model.locator('canvas').screenshot({ timeout: remaining(deadline) })).stats();
    requireCheck(pixels.channels.slice(0, 3).some(channel => channel.stdev > 2), 'model_blank_canvas');
    const matches = lesson.media.filter(asset => asset.kind === 'model3d' && audit.seen.has(digest(mediaIdentity(asset.url, origin))));
    requireCheck(matches.length > 0, 'model_resource_identity_unverified');
    for (const asset of matches) observed.push({ kind: 'model3d', identity: mediaIdentity(asset.url, origin), ok: true });
  }
  return readable || await images.count() > 0 || await media.count() > 0 || await pdfs.count() > 0 || await models.count() > 0;
}

async function exerciseLesson(page, root, lesson, origin, deadline, audit, step, scope) {
  const observed = [];
  const tabs = root.locator('.la-content-nav > button, [class*="contentLinks"] > button');
  const count = await tabs.count();
  const contents = Math.max(1, count);
  for (let index = 0; index < contents; index++) {
    await step(`${scope}/content-${index + 1}`, async () => {
      if (count) {
        const label = await tabs.nth(index).evaluate(element => { const copy = element.cloneNode(true); copy.querySelectorAll('span').forEach(span => span.remove()); return copy.textContent.trim().replace(/^\d+\.\d+\s+/, ''); });
        await tabs.nth(index).click({ timeout: remaining(deadline) });
        await page.waitForFunction(element => element?.getAttribute('aria-current') === 'step', await tabs.nth(index).elementHandle(), { timeout: remaining(deadline) });
        await page.waitForFunction(({ element, label }) => element.querySelector('.la-content-player > h3')?.textContent.trim() === label, { element: await root.elementHandle(), label }, { timeout: remaining(deadline) });
      }
      const content = root.locator('.la-content-player, .lesson-body').first();
      await content.waitFor({ state: 'attached', timeout: remaining(deadline) });
      requireCheck(await content.isVisible(), 'empty_lesson_content');
      // Await text hydration when no media is expected in this content.
      if (!await content.locator('video,audio,img,.la-pdf,.la-model').count() && await content.locator('.la-prose').count()) await visibleText(content.locator('.la-prose'), deadline);
      requireCheck(await checkRenderedContent(page, content, lesson, origin, deadline, observed, audit), 'empty_lesson_content');
      const nodes = content.locator('.la-node-links > button, .la-prose [data-instance-type]');
      for (let ni = 0; ni < await nodes.count(); ni++) {
        await step(`${scope}/content-${index + 1}/exhibit-${ni + 1}`, async () => {
          try {
            await nodes.nth(ni).click({ timeout: remaining(deadline) });
            const modal = page.locator('dialog.la-modal[open]');
            await modal.waitFor({ state: 'visible', timeout: remaining(deadline) });
            requireCheck(!!await visibleText(modal.locator('header h3'), deadline), 'exhibit_title_missing');
            const exercise = modal.locator('.la-exercise');
            if (await exercise.count()) requireCheck(!!await visibleText(exercise.locator('p').first(), deadline), 'empty_exercise');
            else requireCheck(await checkRenderedContent(page, modal.locator('.la-modal-body'), lesson, origin, deadline, observed, audit), 'empty_exhibit');
          } finally {
            const close = page.locator('dialog.la-modal[open] header button');
            if (await close.count()) await close.click({ timeout: remaining(deadline) });
          }
        });
      }
    });
  }
  for (const failure of mediaCoverageFailures(lesson.media, observed, origin)) await step(`${scope}/coverage`, () => { throw new CheckFailure(failure); });
  return { contents, verifiedMedia: observed.map(({ identity, ...item }) => ({ ...item, resource: digest(identity || 'invalid') })) };
}

async function checkTrialGate(page, root, lesson, deadline) {
  if (!lesson.media.some(asset => asset.kind === 'video')) return { applicable: false, reason: 'public_lesson_has_no_video' };
  const tabs = root.locator('[class*="contentLinks"] > button');
  const tabCount = await tabs.count();
  let checked = 0;
  for (let i = 0; i < Math.max(1, tabCount); i++) {
    if (tabCount) {
      await tabs.nth(i).click({ timeout: remaining(deadline) });
      await page.waitForFunction(element => element?.getAttribute('aria-current') === 'step', await tabs.nth(i).elementHandle(), { timeout: remaining(deadline) });
    }
    const video = root.locator('video.la-lesson-video');
    if (!await video.count()) continue;
    const result = await probePlayback(video, remaining(deadline, LIMIT.resource));
    requireCheck(result.ok, result.code || 'preview_video_play_failed');
    requireCheck(result.duration > 60.5, 'preview_gate_not_exercisable_short_video');
    requireCheck(!await page.locator('.la-trial-modal[role="dialog"]').count(), 'preview_gate_triggered_before_limit');
    // Seek close to the boundary and cross it during playback, not while already
    // paused, so a modal alone cannot masquerade as enforcement.
    await video.evaluate(element => { element.currentTime = 59; void element.play().catch(() => undefined); });
    await page.waitForFunction(element => !element.paused && !element.seeking && element.currentTime >= 59 && element.currentTime < 60, await video.elementHandle(), { timeout: remaining(deadline, LIMIT.resource) });
    await video.evaluate(element => { element.currentTime = 60.25; });
    const modal = page.locator('.la-trial-modal[role="dialog"]');
    await modal.waitFor({ state: 'visible', timeout: remaining(deadline) });
    const state = await video.evaluate(element => ({ paused: element.paused, currentTime: element.currentTime }));
    const href = await modal.locator('a.la-trial-pricing').getAttribute('href');
    requireCheck(trialGateStateMatches({ ...state, visible: await modal.isVisible(), upgradeHref: href }), 'preview_gate_did_not_stop_at_60_seconds_with_upgrade');
    await modal.locator('button.la-trial-close').click({ timeout: remaining(deadline) });
    checked++;
  }
  requireCheck(checked > 0, 'preview_gate_no_supported_video');
  return { applicable: true, videosChecked: checked, stoppedAtSeconds: 60, verifiedByNativeSeek: true };
}

/**
 * Requires an existing, entitled student. credentials.locked supplies a
 * DIFFERENT existing student with no entitlement for the native 60-second gate.
 * Missing locked credentials fail closed; denied full lessons and preview gates
 * are separate acceptance checks from entitled playback.
 * No registrations, mail, purchases, entitlement writes, traces or storage states.
 * Opening a lesson does emit the application's normal zero-second study-open event.
 * Raw bodyHash/contentsHash parity is the caller's independent manifest check;
 * this module verifies actual rendered identities, content and media behaviour.
 */
export async function verifyCourseBrowser({ origin, manifest, credentials, outputDir } = {}) {
  const failures = [], evidence = { version: 1, startedAt: new Date().toISOString(), checks: [], screenshots: [], coverage: { locales: LOCALES, courses: 0, lessons: 0 }, exclusions: ['Raw source hashes must be compared independently by the caller; this browser check verifies rendered identity, content presence and media behaviour, not editorial quality.'] };
  const fail = (scope, code, details = {}) => {
    const item = { scope, code, ...details };
    if (!failures.some(value => JSON.stringify(value) === JSON.stringify(item))) failures.push(item);
  };
  const finish = () => ({ ok: failures.length === 0, failures, evidence });
  for (const code of validateBrowserInput({ origin, manifest, credentials, outputDir })) fail('input', code);
  if (failures.length) return finish();
  const step = async (scope, action) => {
    const before = failures.length, started = Date.now();
    try {
      const metrics = await action();
      evidence.checks.push({ scope, ok: failures.length === before, elapsedMs: Date.now() - started, ...(metrics ? { metrics } : {}) });
      return metrics;
    } catch (error) {
      // Playwright messages often embed URLs, request headers and DOM content.
      const code = error instanceof CheckFailure ? error.code : error?.name === 'TimeoutError' ? 'browser_timeout' : 'browser_check_failed';
      fail(scope, code);
      evidence.checks.push({ scope, ok: false, code, elapsedMs: Date.now() - started });
      return undefined;
    }
  };
  let browser;
  const contexts = [];
  const directory = resolve(outputDir, `course-browser-${randomUUID()}`);
  async function context(viewport) {
    const value = await browser.newContext({ viewport, serviceWorkers: 'block', acceptDownloads: false });
    value.setDefaultTimeout(LIMIT.action); value.setDefaultNavigationTimeout(LIMIT.navigation);
    contexts.push(value); return value;
  }
  async function login(fixture, label) {
    let authenticated;
    await step(label, async () => {
      const ctx = await context({ width: 1440, height: 1000 });
      const response = await ctx.request.post(`${origin}/api/auth/login`, { data: { email: fixture.email, password: fixture.password }, headers: { Origin: origin }, maxRedirects: 0, timeout: LIMIT.navigation });
      requireCheck(response.status() === 200, 'fixture_login_failed');
      const body = await response.json();
      requireCheck(body.ok === true && body.data?.user?.role === 'student', 'fixture_not_student');
      const me = await ctx.request.get(`${origin}/api/auth/me`, { maxRedirects: 0, timeout: LIMIT.navigation });
      const identity = await me.json();
      requireCheck(me.status() === 200 && identity.ok === true && identity.user?.role === 'student' &&
        identity.user?.email?.toLowerCase() === fixture.email.toLowerCase(), 'fixture_session_missing');
      // Never return/store account identities or response bodies as evidence.
      authenticated = ctx;
      return { authenticated: true };
    });
    return authenticated;
  }
  async function withPage(ctx, scope, deadline, action) {
    await step(scope, async () => {
      requireCheck(Date.now() < deadline, 'budget_exhausted');
      const page = await ctx.newPage(), audit = auditPage(page, scope, origin, fail);
      try { return await action(page, audit); }
      finally { await audit.settle(deadline); audit.close(); await page.close(); }
    });
  }
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    browser = await chromium.launch({ timeout: LIMIT.navigation });
    const publicContext = await context({ width: 1440, height: 1000 });
    const student = await login(credentials, 'student_login');
    let locked;
    if (credentials.locked?.email && credentials.locked?.password && credentials.locked.email.toLowerCase() !== credentials.email.toLowerCase()) {
      locked = await login(credentials.locked, 'locked_login');
    } else fail('locked_access', 'separate_non_entitled_fixture_required');
    for (const locale of LOCALES) {
      const cataloguePath = `/${locale}/portal/courses`;
      for (const viewport of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'mobile', width: 390, height: 844 }]) {
        const deadline = Date.now() + LIMIT.course;
        await withPage(publicContext, `${locale}/catalogue/${viewport.name}`, deadline, async page => {
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
          await assertPage(page, cataloguePath, origin, deadline);
          const cards = page.locator('.portal-course-card');
          requireCheck(await cards.count() === manifest.courses.length, 'catalogue_course_count_mismatch');
          if (viewport.name === 'mobile') requireCheck(await cards.evaluateAll(elements => elements.every(element => element.getBoundingClientRect().width >= 280)), 'catalogue_mobile_cards_too_narrow');
          for (const [ci, course] of manifest.courses.entries()) {
            await step(`${locale}/catalogue/${viewport.name}/course-${ci + 1}`, async () => {
              const path = `${cataloguePath}/${encodeURIComponent(course.id)}`;
              const card = cards.filter({ has: page.locator(`a[href=${selectorValue(path)}]`) });
              requireCheck(await card.count() === 1, 'catalogue_course_identity_missing_or_duplicate');
              requireCheck(normaliseText(await card.locator('h3').innerText()) === normaliseText(course.title), 'catalogue_title_mismatch');
              const categoryLink = page.locator('.portal-category-filter a');
              const categories = await categoryLink.evaluateAll(elements => elements.map(element => ({ id: new URL(element.href).searchParams.get('category'), title: element.textContent })));
              const category = categories.find(item => item.id === course.category)?.title;
              requireCheck(!!category && normaliseText(await card.locator('.portal-course-category').innerText()) === normaliseText(category), 'catalogue_category_mismatch');
              const image = card.locator('img.course-thumbnail');
              requireCheck(await image.count() === 1, 'catalogue_cover_missing_or_duplicate');
              const src = await checkImage(image, deadline);
              if (course.cover) requireCheck(mediaIdentity(src, origin) === mediaIdentity(course.cover, origin), 'catalogue_cover_identity_mismatch');
              if (course.coverVersion) requireCheck(new URL(src, origin).searchParams.get('versionId') === course.coverVersion, 'catalogue_cover_version_mismatch');
            });
          }
          await page.evaluate(() => window.scrollTo(0, 0));
          requireCheck(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'catalogue_horizontal_overflow');
          // Public catalogue only: never save signed-in pages, trace, HTML or cookies.
          const path = join(directory, `${locale}-${viewport.name}-catalogue.png`);
          await page.screenshot({ path, fullPage: true, timeout: remaining(deadline, LIMIT.resource), mask: [page.locator('header, input, textarea, pre, code, [role="alert"], [role="status"]')] });
          evidence.screenshots.push(path);
        });
      }
      for (const [ci, course] of manifest.courses.entries()) {
        const courseDeadline = Date.now() + LIMIT.course;
        const scope = `${locale}/course-${ci + 1}`;
        const coursePath = `${cataloguePath}/${encodeURIComponent(course.id)}`;
        await withPage(publicContext, `${scope}/detail`, courseDeadline, async page => {
          for (const route of new Set([coursePath, `${cataloguePath}/${encodeURIComponent(course.slug)}`])) {
            await assertPage(page, route, origin, courseDeadline);
            requireCheck(await page.locator('main').getAttribute('data-page-state') === 'available', 'course_not_available');
            requireCheck(normaliseText(await page.locator('h1[data-course-title]').innerText()) === normaliseText(course.title), 'course_title_mismatch');
            requireCheck(await page.locator('[data-course-track]').getAttribute('data-course-track') === course.category, 'course_category_mismatch');
            const rows = page.locator('[data-syllabus] [data-lesson-id]');
            requireCheck(await rows.count() === lessonsOf(course).length, 'syllabus_lesson_count_mismatch');
            for (const lesson of lessonsOf(course)) {
              const row = rows.and(page.locator(`[data-lesson-id=${selectorValue(lesson.id)}]`));
              requireCheck(await row.count() === 1, 'syllabus_lesson_missing');
              const title = await row.locator('h3').evaluate(element => { const copy = element.cloneNode(true); copy.querySelectorAll('span').forEach(span => span.remove()); return copy.textContent; });
              requireCheck(normaliseText(title) === normaliseText(lesson.title), 'syllabus_title_mismatch');
            }
            const src = await checkImage(page.locator('img.course-thumbnail'), courseDeadline);
            if (course.cover) requireCheck(mediaIdentity(src, origin) === mediaIdentity(course.cover, origin), 'course_cover_identity_mismatch');
            if (course.coverVersion) requireCheck(new URL(src, origin).searchParams.get('versionId') === course.coverVersion, 'course_cover_version_mismatch');
          }
        });
        if (student) await withPage(student, `${scope}/entitled-syllabus`, courseDeadline, async page => {
          await assertPage(page, coursePath, origin, courseDeadline);
          for (const lesson of lessonsOf(course)) {
            const links = page.locator(`[data-syllabus] [data-lesson-id=${selectorValue(lesson.id)}] a`);
            requireCheck(await links.count() > 0, 'entitled_syllabus_link_missing');
            for (const link of await links.all()) {
              const expected = `/${locale}/account/learn/${course.id}?lessonId=${encodeURIComponent(lesson.id)}`;
              requireCheck(routeMatches(await link.getAttribute('href'), expected, origin), 'entitled_syllabus_wrong_lesson');
            }
          }
        });
        const first = lessonsOf(course)[0];
        if (student && first?.isPublic) {
          const deadline = Math.min(courseDeadline, Date.now() + LIMIT.lesson);
          await withPage(student, `${scope}/preview`, deadline, async (page, audit) => {
            await assertPage(page, `${coursePath}/public-lesson?lessonId=${encodeURIComponent(first.id)}`, origin, deadline);
            const root = await checkLessonIdentity(page, course, first, deadline);
            return exerciseLesson(page, root, first, origin, deadline, audit, step, `${scope}/preview`);
          });
        } else if (!first?.isPublic) fail(`${scope}/preview`, 'reference_public_first_lesson_missing');
        if (locked && first?.isPublic) {
          const deadline = Math.min(courseDeadline, Date.now() + LIMIT.lesson);
          await withPage(locked, `${scope}/preview-gate`, deadline, async (page, audit) => {
            const access = await locked.request.get(`${origin}/api/entitlements/check?courseId=${encodeURIComponent(course.id)}`, { timeout: remaining(deadline), maxRedirects: 0 });
            requireCheck(access.status() === 200 && (await access.json()).entitlement?.allowed === false, 'preview_fixture_must_not_be_entitled');
            await assertPage(page, `${coursePath}/public-lesson?lessonId=${encodeURIComponent(first.id)}`, origin, deadline);
            const root = await checkLessonIdentity(page, course, first, deadline);
            await exerciseLesson(page, root, first, origin, deadline, audit, step, `${scope}/locked-preview`);
            return checkTrialGate(page, root, first, deadline);
          });
        }
        for (const [li, lesson] of lessonsOf(course).entries()) {
          const lessonScope = `${scope}/lesson-${li + 1}`;
          if (locked) {
            const deadline = Math.min(courseDeadline, Date.now() + LIMIT.lesson);
            await withPage(locked, `${lessonScope}/locked`, deadline, async page => {
              const path = `/${locale}/account/learn/${encodeURIComponent(course.id)}?lessonId=${encodeURIComponent(lesson.id)}`;
              const response = await page.goto(new URL(path, origin).href, { waitUntil: 'domcontentloaded', timeout: remaining(deadline, LIMIT.navigation) });
              requireCheck(response?.status() === 200 && routeMatches(page.url(), coursePath, origin), 'locked_lesson_not_denied_to_course_upsell');
              requireCheck(!await page.locator('[data-course-id][data-lesson-id], .learning-room, .lesson-content, video, audio').count(), 'locked_lesson_content_leaked');
              requireCheck(normaliseText(await page.locator('h1[data-course-title]').innerText()) === normaliseText(course.title), 'locked_upsell_course_identity_mismatch');
              const pricing = page.locator('a[data-course-secondary-cta], a[data-course-cta-link="view_plans"]');
              requireCheck(await pricing.count() > 0 && (await pricing.first().getAttribute('href'))?.startsWith(`/${locale}/pricing?`), 'locked_upsell_missing');
              return { denied: true, upsell: true };
            });
          } else fail(`${lessonScope}/locked`, 'not_run_locked_fixture_unavailable');
          if (!student) { fail(lessonScope, 'not_run_student_login_failed'); continue; }
          const deadline = Math.min(courseDeadline, Date.now() + LIMIT.lesson);
          await withPage(student, lessonScope, deadline, async (page, audit) => {
            const path = `/${locale}/account/learn/${encodeURIComponent(course.id)}?lessonId=${encodeURIComponent(lesson.id)}`;
            await assertPage(page, path, origin, deadline);
            const root = await checkLessonIdentity(page, course, lesson, deadline);
            requireCheck(normaliseText(await root.locator('.lesson-nav > .portal-eyebrow').textContent()) === normaliseText(course.title), 'learning_course_title_mismatch');
            requireCheck(await root.locator(`.lesson-nav a.active[href=${selectorValue(path)}]`).count() === 1, 'active_lesson_navigation_mismatch');
            const metrics = await exerciseLesson(page, root, lesson, origin, deadline, audit, step, lessonScope);
            evidence.coverage.lessons += 1;
            return metrics;
          });
        }
        evidence.coverage.courses += 1;
      }
    }
  } catch (error) { fail('runner', error instanceof CheckFailure ? error.code : 'browser_runner_failed'); }
  finally {
    for (const ctx of contexts) await ctx.close().catch(() => fail('cleanup', 'browser_context_close_failed'));
    if (browser) await browser.close().catch(() => fail('cleanup', 'browser_close_failed'));
    evidence.finishedAt = new Date().toISOString();
  }
  try { await writeFile(join(directory, 'result.json'), JSON.stringify(finish(), null, 2), { mode: 0o600 }); }
  catch { fail('evidence', 'evidence_write_failed'); }
  return finish();
}
