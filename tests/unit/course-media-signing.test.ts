import test from 'node:test';
import assert from 'node:assert/strict';
import { signCourseMediaUrl } from '../../services/persistence/s3';
import { signCourseMediaReferences } from '../../services/courseMediaSigning';

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

test('Modeling life video URLs are signed without allowing other staging objects or bypassing UAT media pins', async () => {
  const environment = { ...process.env };
  try {
    Object.assign(process.env, { APP_ENV: 'DEV', AWS_ACCESS_KEY_ID: 'fake_signing_test', AWS_SECRET_ACCESS_KEY: 'fake_signing_test_only', AWS_REGION: 'ap-southeast-1' });
    delete process.env.AWS_SESSION_TOKEN;
    const base = 'https://aitutor-data-851987565851.s3.ap-southeast-1.amazonaws.com/learning-guide/dev/staging/modeling-life/';
    for (const appEnv of ['DEV', 'SIT']) {
      process.env.APP_ENV = appEnv;
      const input = [1,2].map(lesson => ({ id: `lesson-${lesson}`, contents: [{ url: `${base}lesson${lesson}.mp4`, nodes: [] }] }));
      const output = await signCourseMediaReferences(input);
      for (const [index, lesson] of output.entries()) {
        const signed = new URL(lesson.contents[0].url);
        assert.equal(signed.pathname, `/learning-guide/dev/staging/modeling-life/lesson${index+1}.mp4`);
        assert.equal(signed.searchParams.get('X-Amz-Expires'), '1800');
        assert.ok(signed.searchParams.has('X-Amz-Signature'));
        assert.equal(input[index].contents[0].url, `${base}lesson${index+1}.mp4`, 'stored catalogue keeps the stable unsigned identity');
      }
    }
    for (const value of [base+'lesson3.mp4',base+'lesson1.mp4/extra',base.replace('modeling-life/','other-course/')+'lesson1.mp4',base+'%6cesson1.mp4',base+'%2e%2e/lesson1.mp4',base.replace('https://','https://user:password@')+'lesson1.mp4']) {
      assert.equal(await signCourseMediaUrl(value), value, 'only the exact approved host and object paths are signed');
    }
    process.env.APP_ENV = 'UAT';
    await assert.rejects(() => signCourseMediaUrl(base+'lesson1.mp4'), /UAT release manifest/);
  } finally { process.env = environment; }
});
