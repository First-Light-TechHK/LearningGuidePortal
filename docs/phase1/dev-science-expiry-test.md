# DEV Science early-expiry test (2026-10-26)

The user authorised shortening one existing six-month Science purchase starting on **2026-10-26 Asia/Shanghai**. Migration `014_shorten_dev_science_subscription` matches the requested account by SHA-256 of its trimmed, lower-case email; no plaintext account address is committed or logged.

The new exclusive expiry is **2026-10-27 00:00 Asia/Shanghai**, stored as **2026-10-26T16:00:00.000Z**. Subscription.validTo and its matching purchase Entitlement.validTo change together. The original state and automatic-renewal setting remain; normal server access checks and portal reads derive expiry. Orders retain their original purchased service period.

Execution uses the existing `npm start` -> `scripts/start-with-data-migrations.cjs` -> `data:migrate --apply --boot` transaction. It requires `APP_ENV=DEV`, `DATA_S3_PREFIX=learning-guide/dev` and SQL migration context. SIT/UAT/PPE/PROD and local aggregate reads skip. No workflow or environment-secret change is needed. Push the reviewed migration and registry entry to `dev` with the tests and documentation.

Before writing, the migration requires exactly one matching account, one paid Science Category six-month subscription beginning on the requested Shanghai date, its original end date on 2027-04-26, and one active, same-device, same-expiry Science purchase entitlement. Missing/ambiguous targets or changed/refunded/revoked/grace data fail before either row changes, rolling back the data transaction. The latest DEV startup wrapper logs migration failure and may still start Next.js; a successful deployment alone does not prove this override ran. Check the migration report and saved records. It never selects another account or the newest subscription as a fallback.

The database migration ledger records the change once in the same transaction. A repeated deployment skips it, including after a later paid renewal. Direct application also skips an already-shortened pair. An operator dry-run uses the existing DEV cloud migration command and reports two updates; SQL execution is required to persist. Do not run `--apply` against live data before the intended deployment.

This migration changes the application's local access deadline only. Stripe's billing period, automatic debit date and subscription object remain unchanged. Later verified paid renewal can restore access using the provider period. Accelerated provider billing itself requires a separate sandbox simulation.

Validation:

```sh
node --import tsx --require ./scripts/register-tsconfig-paths.cjs --test tests/unit/dev-science-expiry-migration.test.ts tests/unit/data-migrations.test.ts tests/unit/catalogue-migrations.test.ts
node --import tsx --require ./scripts/register-tsconfig-paths.cjs --test tests/io/dev-science-expiry.test.ts
npm run typecheck
npm run typecheck:io
npm run build
```

After DEV deployment, inspect startup output for migration 014 and exactly one Subscription/Entitlement update each. Inspect both saved records and confirm their new UTC expiry. Before the boundary, verify My Subscription and Science Course access in both locales. At/after the boundary, refresh and verify expired presentation, denied protected API access and preserved learning/payment history. Other accounts and other Category products must be unaffected; any separate valid Everything/Science entitlement can still grant access. Complete a normal test repurchase/verified renewal and confirm access returns, then redeploy and confirm 014 does not shorten that paid period. Target-environment execution remains pending until deployment.

Rollback does not remove the ledger or rerun the migration. To cancel the test, create a separate reviewed DEV-only repair against the recorded target ids and original deadline after checking for intervening paid renewal/refund/provider changes. Do not restore an old snapshot over live data.

Local validation on latest DEV base c64c1c5 passed: 25 focused migration/access/renewal/API tests, both TypeScript configurations, scoped ESLint, local migration dry-run (persisted:false, objects:0), and npm run build. All fixtures use synthetic accounts and disposable local storage. The deployment migration has not been manually applied to live data.
