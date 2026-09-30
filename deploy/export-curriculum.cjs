const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { Client } = require('pg');
const fs = require('node:fs');

exports.handler = async () => {
  const secrets = new SecretsManagerClient({});
  const connectionString = (await secrets.send(new GetSecretValueCommand({ SecretId: process.env.APP_SECRET }))).SecretString;
  const ssl = { rejectUnauthorized: true, ca: fs.readFileSync('ca.pem', 'utf8') };
  const client = new Client({ connectionString, ssl });
  await client.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = await client.query("SELECT content FROM app_files WHERE path = 'learning_guide/product.json'");
    const data = result.rowCount ? JSON.parse(result.rows[0].content) : {};
    // Match runtime precedence: normalised ORM rows override legacy snapshot rows.
    const exists = await client.query("SELECT to_regclass('public.orm_rows') AS name");
    if (exists.rows[0].name) {
      const rows = await client.query("SELECT table_name, id, payload FROM orm_rows WHERE table_name IN ('courses', 'plans', 'doc:portalContent')");
      for (const name of ['courses', 'plans']) {
        const merged = new Map((data[name] || []).map(item => [item.id, item]));
        for (const row of rows.rows.filter(item => item.table_name === name)) merged.set(row.id, row.payload);
        data[name] = [...merged.values()];
      }
      const content = rows.rows.find(row => row.table_name === 'doc:portalContent');
      if (content) data.portalContent = content.payload;
    }
    const product = Object.fromEntries(['version', 'courses', 'plans', 'portalContent'].filter(k => k in data).map(k => [k, data[k]]));
    await client.query('COMMIT');
    return { ok: true, product };
  } finally {
    await client.end();
  }
};
