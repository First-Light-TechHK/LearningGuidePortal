// @ts-nocheck -- the release entry point is intentionally executable plain ESM.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareCurricula, curriculumManifest } from '../../scripts/release/curriculum.mjs';

const lesson = (id, title) => ({ id, title, isPublic: true, body: `Body of ${title}`, contents: [], preview: null });

function product(course = {}) {
  return {
    courses: [{
      id: 'modeling-life',
      slug: 'modeling-life',
      title: 'Modeling Life',
      category: 'Science',
      status: 'published',
      cover: null,
      createdAt: '2026-11-17T04:22:23.345Z',
      updatedAt: '2026-11-17T04:22:23.345Z',
      revision: 3,
      sections: [{ id: 'section-one', title: 'Foundations', lessons: [lesson('lesson-one', 'State Spaces'), lesson('lesson-two', 'Pitchfork')] }],
      ...course,
    }],
  };
}

test('the same content matches across environments that wrote different timestamps', () => {
  const sit = curriculumManifest(product());
  const uat = curriculumManifest(product({ createdAt: '2026-11-17T04:22:24.877Z', updatedAt: '2026-11-17T04:22:24.877Z', revision: 11 }));
  assert.deepEqual(compareCurricula(sit, uat), { ok: true, failures: [] });
  assert.notEqual(sit.courses[0].revision, '');
  assert.equal(sit.courses[0].revision, uat.courses[0].revision, 'the content digest ignores write timestamps and the draft counter');
});

test('a changed Lesson title still fails parity for that Course', () => {
  const sit = curriculumManifest(product());
  const changed = product();
  changed.courses[0].sections[0].lessons[1].title = 'Pitchfork Bifurcation';
  assert.deepEqual(compareCurricula(sit, curriculumManifest(changed)).failures, ['Course differs from SIT: modeling-life']);
});

test('changed Lesson content, a missing Course and an extra Course all fail parity', () => {
  const sit = curriculumManifest(product());
  const changedBody = product();
  changedBody.courses[0].sections[0].lessons[0].body = 'Different reading content';
  assert.deepEqual(compareCurricula(sit, curriculumManifest(changedBody)).failures, ['Course differs from SIT: modeling-life']);
  assert.deepEqual(compareCurricula(sit, curriculumManifest({ courses: [] })).failures, ['Missing SIT course: modeling-life']);
  const extra = product();
  extra.courses.push({ ...extra.courses[0], id: 'extra-course', slug: 'extra-course' });
  assert.deepEqual(compareCurricula(sit, curriculumManifest(extra)).failures, ['Unexpected UAT course: extra-course']);
});

test('an unpublished Course stays out of the manifest', () => {
  const manifest = curriculumManifest(product({ status: 'draft' }));
  assert.deepEqual(manifest.courses, []);
});
