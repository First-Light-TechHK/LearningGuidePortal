// Operator-only Lambda. Not an application endpoint and never used in production.
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { Client } = require('pg');
const { randomBytes, scryptSync } = require('node:crypto');
const fs = require('node:fs');

exports.handler = async event => {
  if (process.env.APP_SECRET !== 'learning-guide/uat/database_url' || !/^[a-f0-9]{16}$/.test(event.run || '') || !['create', 'remove'].includes(event.action)) throw new Error('Invalid UAT fixture operation');
  const connectionString = (await new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: process.env.APP_SECRET }))).SecretString;
  if (new URL(connectionString).pathname !== '/learning_guide_uat') throw new Error('Not the isolated UAT database');
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: true, ca: fs.readFileSync('ca.pem', 'utf8') } });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(719301, 1)');
    const result = await client.query("SELECT content FROM app_files WHERE path = 'learning_guide/product.json' FOR UPDATE");
    if (result.rowCount !== 1) throw new Error('UAT product aggregate missing');
    const data = JSON.parse(result.rows[0].content);
    const ids = ['entitled', 'locked'].map(kind => `acceptance_${event.run}_${kind}`);
    const credentials = {};
    for (const [index, id] of ids.entries()) {
      const email = `acceptance+${event.run}-${index}@ilovelearningguide.com`;
      const existing = (data.users || []).find(user => user.id === id || user.email === email);
      if (existing && (existing.id !== id || existing.email !== email)) throw new Error('Fixture identity collision');
      if (event.action === 'create') {
        if (existing) throw new Error('Fixture already exists');
        const password = randomBytes(32).toString('base64url');
        const salt = randomBytes(16).toString('hex');
        const createdAt = new Date().toISOString();
        const user = { id, email, nickname: 'UAT Acceptance', passwordHash: `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`, locale: 'en-GB', role: 'student', status: 'active', emailVerifiedAt: createdAt, createdAt, areasOfInterest: [] };
        data.users.push(user);
        await client.query("INSERT INTO orm_rows(table_name,id,payload) VALUES('users',$1,$2::jsonb)", [id, JSON.stringify(user)]);
        if (index === 0) {
          const entitlement = { id: `${id}_access`, userId: id, courseId: '*', state: 'active', source: 'trial', scope: 'everything', scopeId: '*', device: 'pc', validTo: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() };
          data.entitlements.push(entitlement);
          await client.query("INSERT INTO orm_rows(table_name,id,payload) VALUES('entitlements',$1,$2::jsonb)", [entitlement.id, JSON.stringify(entitlement)]);
        }
        credentials[index === 0 ? 'entitled' : 'locked'] = { email, password };
      } else {
        // Only this run's synthetic identities and their own state are removed.
        for (const table of ['users', 'sessions', 'entitlements', 'studyRecords', 'studyEvents', 'courseProgress', 'learningProgress', 'notifications']) {
          if (Array.isArray(data[table])) data[table] = data[table].filter(row => row.id !== id && row.userId !== id);
          await client.query("DELETE FROM orm_rows WHERE table_name = $1 AND (id = $2 OR payload->>'userId' = $2)", [table, id]);
        }
      }
    }
    const content = JSON.stringify(data);
    await client.query("UPDATE app_files SET content=$1, byte_size=$2, updated_at=NOW() WHERE path='learning_guide/product.json'", [content, Buffer.byteLength(content)]);
    await client.query('COMMIT');
    return { ok: true, credentials };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { await client.end(); }
};
