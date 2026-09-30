import test from 'node:test';
import assert from 'node:assert/strict';
import manifest from '@/deploy/uat-course-media.json';
import { courseMediaVersion } from '@/services/persistence/courseMediaRelease';

test('UAT media is pinned to the recorded S3 object version', () => {
  for (const asset of manifest.objects) {
    assert.equal(courseMediaVersion(asset.bucket, asset.key, 'UAT'), asset.version);
    assert.ok(asset.version && asset.version !== 'null');
  }
});
test('unreviewed UAT archive media fails closed without affecting SIT or DEV', () => {
  assert.throws(() => courseMediaVersion('aitutor-data-851987565851', 'learning-guide/dev/documents/mvp/new.mp4', 'UAT'), /manifest/);
  assert.equal(courseMediaVersion('aitutor-data-851987565851', 'new.mp4', 'SIT'), undefined);
  assert.equal(courseMediaVersion('aitutor-data-851987565851', 'new.mp4', 'DEV'), undefined);
});
