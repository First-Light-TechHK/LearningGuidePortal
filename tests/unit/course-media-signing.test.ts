import test from 'node:test';
import assert from 'node:assert/strict';
import { signCourseMediaUrl } from '../../services/persistence/s3';

test('course video signatures last 30 minutes while other media and explicit lifetimes are retained', async () => {
  const environment = { ...process.env };
  try {
    Object.assign(process.env, { APP_ENV: 'DEV', AWS_ACCESS_KEY_ID: 'fake_signing_test', AWS_SECRET_ACCESS_KEY: 'fake_signing_test_only', AWS_REGION: 'ap-southeast-1' });
    delete process.env.AWS_SESSION_TOKEN;
    const base = 'https://aitutor-data-851987565851.s3.ap-southeast-1.amazonaws.com/learning-guide/dev/documents/mvp/';
    for (const filename of ['video/lesson.mp4', 'video/lesson.WEBM', 'video/lesson.mov']) {
      const signed = new URL(await signCourseMediaUrl(base + filename));
      assert.equal(signed.searchParams.get('X-Amz-Expires'), '1800');
      assert.ok(signed.searchParams.has('X-Amz-Signature'));
    }
    assert.equal(new URL(await signCourseMediaUrl(base + 'image/cover.jpg')).searchParams.get('X-Amz-Expires'), '300');
    assert.equal(new URL(await signCourseMediaUrl(base + 'video/lesson.mp4', 60)).searchParams.get('X-Amz-Expires'), '60');
    assert.equal(await signCourseMediaUrl('https://other.example/video.mp4'), 'https://other.example/video.mp4');
  } finally { process.env = environment; }
});
