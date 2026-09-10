const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { Client } = require('pg');
const fs = require('node:fs');

exports.handler = async (event) => {
  const secrets = new SecretsManagerClient({});
  const get = async id => (await secrets.send(new GetSecretValueCommand({ SecretId: id }))).SecretString;
  const admin = JSON.parse(await get(process.env.MASTER_SECRET));
  const connectionString = await get(process.env.APP_SECRET);
  const app = new URL(connectionString);
  const password = decodeURIComponent(app.password);
  if (!/^[a-f0-9]{64}$/.test(password)) throw new Error('Unexpected generated application credential format');
  const ssl = { rejectUnauthorized: true, ca: fs.readFileSync('ca.pem', 'utf8') };
  const db = new Client({ host: process.env.DB_HOST, user: admin.username, password: admin.password, database: 'learning_guide_sit', ssl });
  await db.connect();
  try {
    if (event.action !== 'verify') {
      const role = await db.query("SELECT 1 FROM pg_roles WHERE rolname = 'lg_sit_app'");
      if (!role.rowCount) await db.query(`CREATE ROLE lg_sit_app LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE`);
      await db.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
      await db.query('GRANT CONNECT ON DATABASE learning_guide_sit TO lg_sit_app');
      await db.query('GRANT USAGE, CREATE ON SCHEMA public TO lg_sit_app');
    }
  } finally { await db.end(); }
  const client = new Client({ connectionString, ssl });
  await client.connect();
  try {
    if (event.action !== 'verify') {
      await client.query(`CREATE TABLE IF NOT EXISTS app_files (
        path TEXT PRIMARY KEY, storage TEXT NOT NULL CHECK (storage IN ('db','s3')),
        content TEXT, s3_key TEXT, byte_size INTEGER NOT NULL DEFAULT 0,
        content_type TEXT NOT NULL DEFAULT 'application/octet-stream', updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      ); CREATE INDEX IF NOT EXISTS app_files_path_prefix_idx ON app_files(path text_pattern_ops);`);
      await client.query(fs.readFileSync('009_product_payment_keys.sql', 'utf8'));
      if (event.product) {
        const allowed = ['version', 'courses', 'plans', 'portalContent', 'paymentSettings'];
        const product = Object.fromEntries(allowed.filter(key => key in event.product).map(key => [key, event.product[key]]));
        for (const key of ['users','sessions','quotes','orders','subscriptions','entitlements','studyRecords','studyEvents','conversations','notifications','stripeEvents','verificationTokens','passwordResetTokens','orderActivities','accounts']) product[key] = [];
        product.paymentSettings = { provider: 'stripe', name: 'Stripe', publishableKey: '', returnUrl: '', defaultCurrency: 'usd', paymentNotifications: true, updatedAt: null };
        const content = JSON.stringify(product);
        await client.query("INSERT INTO app_files(path, storage, content, byte_size, content_type) VALUES ('learning_guide/product.json','db',$1,$2,'application/json') ON CONFLICT DO NOTHING", [content, Buffer.byteLength(content)]);
      }
    }
    const result = await client.query("SELECT current_database() AS database, current_user AS role, to_regclass('public.product_payment_keys') IS NOT NULL AS migration, (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS tls");
    return { ok: true, ...result.rows[0] };
  } finally { await client.end(); }
};
