import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as crypto from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { isBusinessEmail } from '../../lib/emailValidation';

function fixture(secret = 'learning-guide/uat/database_url') {
  let product = { users: [{ id: 'existing', email: 'existing@example.test' }], entitlements: [], sessions: [] };
  const exports: { handler?: (event: unknown) => Promise<any> } = {};
  const writes: string[] = [];
  class Client {
    async connect() {}
    async end() {}
    async query(sql: string, params: any[] = []) {
      writes.push(sql);
      if (sql.startsWith('SELECT content')) return { rowCount: 1, rows: [{ content: JSON.stringify(product) }] };
      if (sql.startsWith('UPDATE app_files')) product = JSON.parse(params[0]);
      return { rowCount: 1, rows: [] };
    }
  }
  runInNewContext(readFileSync('deploy/uat-acceptance-fixture.cjs', 'utf8'), {
    exports, Buffer, URL,
    process: { env: { APP_SECRET: secret } },
    require: (name: string) => {
      if (name === 'pg') return { Client };
      if (name === 'node:crypto') return crypto;
      if (name === 'node:fs') return { readFileSync: () => 'test-ca' };
      if (name === '@aws-sdk/client-secrets-manager') return {
        SecretsManagerClient: class { async send() { return { SecretString: 'postgres://test:test@localhost/learning_guide_uat' }; } },
        GetSecretValueCommand: class {}
      };
      throw new Error(`Unexpected dependency: ${name}`);
    }
  });
  return { invoke: exports.handler!, product: () => product, writes };
}

test('UAT synthetic learners satisfy real login validation and have matching password hashes', async () => {
  const harness = fixture();
  const run = '1234567890abcdef';
  const result = await harness.invoke({ action: 'create', run });
  for (const credential of Object.values(result.credentials) as { email: string; password: string }[]) {
    assert.equal(isBusinessEmail(credential.email), true);
    const user = harness.product().users.find(user => user.email === credential.email) as any;
    const [, salt, hash] = user.passwordHash.split('$');
    assert.equal(crypto.scryptSync(credential.password, salt, 64).toString('hex'), hash);
    assert.equal(user.status, 'active');
    assert.equal(user.role, 'student');
    assert.ok(user.emailVerifiedAt);
  }
  assert.equal(harness.product().entitlements.length, 1);
  await harness.invoke({ action: 'remove', run });
  assert.deepEqual(harness.product().users, [{ id: 'existing', email: 'existing@example.test' }]);
  assert.equal(harness.product().entitlements.length, 0);
});

test('acceptance fixtures refuse SIT and malformed operations before any database write', async () => {
  const sit = fixture('learning-guide/sit/database_url');
  await assert.rejects(sit.invoke({ action: 'create', run: '1234567890abcdef' }), /Invalid UAT fixture/);
  assert.equal(sit.writes.length, 0);
  const uat = fixture();
  await assert.rejects(uat.invoke({ action: 'remove', run: 'all' }), /Invalid UAT fixture/);
  assert.equal(uat.writes.length, 0);
});
