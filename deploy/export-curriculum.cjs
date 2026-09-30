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
    const result = await client.query("SELECT content FROM app_files WHERE path = 'learning_guide/product.json'");
    const data = result.rowCount ? JSON.parse(result.rows[0].content) : {};
    const product = Object.fromEntries(['version', 'courses', 'plans', 'portalContent'].filter(k => k in data).map(k => [k, data[k]]));
    return { ok: true, product };
  } finally {
    await client.end();
  }
};
