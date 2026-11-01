// Read-only pre-flight for migration 025: report duplicate identities that would
// make the CREATE UNIQUE INDEX statements fail and block the SIT boot.
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
    const exists = await client.query("SELECT to_regclass('public.orm_rows') AS name");
    if (!exists.rows[0].name) {
      await client.query('COMMIT');
      return { ok: true, noOrmRows: true, duplicates: {} };
    }
    const email = await client.query(`
      SELECT lower(btrim(payload->>'email')) AS key, count(*)::int AS n
      FROM orm_rows WHERE table_name = 'users' AND nullif(btrim(payload->>'email'), '') IS NOT NULL
      GROUP BY 1 HAVING count(*) > 1 ORDER BY n DESC LIMIT 20`);
    const account = await client.query(`
      SELECT (payload->>'provider') || '|' || (payload->>'providerSubject') AS key, count(*)::int AS n
      FROM orm_rows WHERE table_name = 'accounts'
      GROUP BY 1 HAVING count(*) > 1 ORDER BY n DESC LIMIT 20`);
    const token = await client.query(`
      SELECT (payload->>'tokenHash') AS key, count(*)::int AS n
      FROM orm_rows WHERE table_name = 'emailBindingTokens' AND payload->>'tokenHash' IS NOT NULL
      GROUP BY 1 HAVING count(*) > 1 ORDER BY n DESC LIMIT 20`);
    const totals = await client.query(`
      SELECT table_name, count(*)::int AS n FROM orm_rows
      WHERE table_name IN ('users','accounts','emailBindingTokens') GROUP BY 1`);
    await client.query('COMMIT');
    return {
      ok: true,
      duplicates: {
        users_email: email.rows,
        accounts_provider: account.rows,
        email_binding_token: token.rows,
      },
      totals: Object.fromEntries(totals.rows.map((r) => [r.table_name, r.n])),
    };
  } finally {
    await client.end();
  }
};
