import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { productTransaction } from "../../repositories/productTransactionRepository";

test("local transactions reject duplicate normalized emails, provider identities and proofs before persistence", async () => {
  const backend = process.env.STORAGE_BACKEND;
  process.env.STORAGE_BACKEND = "local";
  try {
    const valid = { orders: [], stripeEvents: [], users: [{ email: null }, { email: null }], accounts: [{ provider: "google", providerSubject: "same-subject" }, { provider: "wechat", providerSubject: "same-subject" }], emailBindingTokens: [{ tokenHash: "one" }] };
    let saved = 0;
    await productTransaction(async () => ({ data: valid, result: null }), async () => { saved++; });
    assert.equal(saved, 1);
    for (const data of [
      { ...valid, users: [{ email: "Same@example.test" }, { email: " same@EXAMPLE.test " }] },
      { ...valid, accounts: [{ provider: "wechat", providerSubject: "same" }, { provider: "wechat", providerSubject: "same" }] },
      { ...valid, emailBindingTokens: [{ tokenHash: "one" }, { tokenHash: "one" }] },
    ]) await assert.rejects(productTransaction(async () => ({ data, result: null }), async () => { saved++; }), /Duplicate authentication identity/);
    assert.equal(saved, 1, "rejected identities cannot partially persist");
  } finally {
    if (backend === undefined) delete process.env.STORAGE_BACKEND; else process.env.STORAGE_BACKEND = backend;
  }
});

test("025 protects live ORM authentication identities and is mirrored by schema bootstrap/probe", async () => {
  const migration = await readFile("db/migrations/025_auth_identity_keys.sql", "utf8");
  const bootstrap = await readFile("services/persistence/db.ts", "utf8");
  const normalise = (sql: string) => sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
  assert.doesNotMatch(normalise(migration), /\b(DROP|DELETE|UPDATE|TRUNCATE)\b/i);
  for (const statement of migration.match(/CREATE UNIQUE INDEX IF NOT EXISTS[^;]+;/g) || []) assert.ok(normalise(bootstrap).includes(normalise(statement)));
  for (const name of ["orm_users_email_key", "orm_accounts_provider_subject_key", "orm_email_binding_token_hash_key"]) assert.ok(bootstrap.includes(`to_regclass('${name}') IS NOT NULL`));
  assert.match(migration, /lower\(btrim\(payload->>'email'\)\)/);
  assert.match(migration, /providerSubject/);
});
