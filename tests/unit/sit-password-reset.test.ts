import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import nodemailer from 'nodemailer';

test('SIT emails reset links on its trusted origin and never returns a token', async () => {
  const env = { ...process.env };
  const cwd = process.cwd();
  const temp = await mkdtemp(path.join(tmpdir(), 'lg-reset-test-'));
  const mails: Array<{ text: string }> = [];
  const transport = mock.method(nodemailer, 'createTransport', () => ({ sendMail: async (mail: { text: string }) => { mails.push(mail); } }));
  try {
    process.chdir(temp);
    Object.assign(process.env, { APP_ENV: 'SIT', STORAGE_BACKEND: 'local', SMTP_HOST: 'smtp.test', SMTP_USER: 'sender@test.invalid', SMTP_PASS: 'test-only', NEXT_PUBLIC_APP_URL: 'https://sit.ilovelearningguide.com' });
    const store = await import('../../services/productStore');
    const user = await store.registerUser({ email: 'reset@example.test', password: 'test-password-123', locale: 'en-GB' });
    await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
    const { POST } = await import('../../app/api/auth/password-reset/request/route');
    const request = (email: string) => new Request('https://untrusted.invalid/api/auth/password-reset/request', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-host': 'untrusted.invalid' }, body: JSON.stringify({ email }) });
    const known = await POST(request(user.email!));
    const unknown = await POST(request('unknown@example.test'));
    assert.equal(known.status, 200);
    assert.deepEqual(await known.json(), { ok: true, resetUrl: null });
    assert.deepEqual(await unknown.json(), { ok: true, resetUrl: null });
    assert.equal(mails.length, 1);
    assert.ok(mails[0].text.includes('https://sit.ilovelearningguide.com/en-GB/portal/reset-password?token='));
    assert.ok(!mails[0].text.includes('untrusted.invalid'));
  } finally {
    transport.mock.restore();
    process.env = env;
    process.chdir(cwd);
    await rm(temp, { recursive: true, force: true });
  }
});
