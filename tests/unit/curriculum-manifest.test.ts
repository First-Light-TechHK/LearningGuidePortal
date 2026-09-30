import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error release tooling is native ESM
import { curriculumManifest, compareCurricula, mediaReferences } from '../../scripts/release/curriculum.mjs';
const product = { courses: [{ id: 'a', slug: 'a', title: 'History', status: 'published', sections: [{ id: 's', lessons: [{ id: 'l', body: 'Expected lesson', isPublic: true }] }] }] };
test('curriculum gate checks lesson bodies, missing and unexpected courses', () => {
  const reference = curriculumManifest(product);
  assert.equal(compareCurricula(reference, curriculumManifest(structuredClone(product))).ok, true);
  const changed = structuredClone(product); changed.courses[0].sections[0].lessons[0].body = 'Wrong lesson';
  assert.equal(compareCurricula(reference, curriculumManifest(changed)).ok, false);
  assert.equal(compareCurricula(reference, curriculumManifest({ courses: [] })).ok, false);
  assert.equal(compareCurricula(curriculumManifest({ courses: [] }), reference).ok, false);
});
test('media inventory is complete, deterministic and excludes signed credentials', () => {
  const result = mediaReferences({ cover: 'https://bucket.example/cover.png?X-Amz-Signature=secret', contents: [{ url: 'https://bucket.example/lesson.mp4' }, { html: '<img src="https://bucket.example/diagram.jpg">' }] });
  assert.equal(result.length, 3);
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal(result.find((item: { kind: string }) => item.kind === 'video').url, 'https://bucket.example/lesson.mp4');
});
