# Data update direction (DEV)

DEV App Runner (`learning-guide-portal`, www + admin) tracks the **`dev`** branch and auto-deploys it. **`main` is not the auto-sync source.** SIT stays a manual `Deploy SIT` dispatch.

**How to write a script:** [writing-data-migrations.md](writing-data-migrations.md).

Do not commit `data/` or replace cloud `product.json`. Users, sessions, orders and entitlements stay in the live aggregate unless a migration declares those `touches` and is reviewed as a backfill.

## How AWS runs a data change

| Pattern | Use | This repo |
|---|---|---|
| **Migrate on boot** | Any product-aggregate change (courses, portal, plans, backfills) | **Default.** Push **`dev`**. `npm start` → `scripts/start-with-data-migrations.cjs` → persist pending `db/data-migrations/*` → `next start`. A failed migration fails the revision. |
| **CI retry** | Dry-run or re-apply DEV without a new start | Optional **Sync catalogue** workflow (`workflow_dispatch` only, never on push). Checks out **`dev`**. Needs `DEV_DATABASE_URL` and `DEV_DATA_S3_BUCKET`. |
| **Laptop `--cloud`** | Operator apply with local AWS/DB env | `CONFIRM_DATA_SYNC=learning-guide/dev` + `APP_ENV=DEV` + `DATA_S3_PREFIX=learning-guide/dev` |
| **SQL schema** | Postgres tables/constraints | `db/migrations/*.sql` only. Data scripts do not ALTER tables. |
| **SIT bootstrap** | New SIT store, catalogue slice only | `scripts/provision-sit.mjs` (not everyday sync) |

## What boot persist actually writes

This is **not** a schema migration. It rewrites one JSON row in **that environment’s own RDS**:

1. `BEGIN`
2. `SELECT storage, content FROM app_files WHERE path = 'learning_guide/product.json' FOR UPDATE`
3. Parse the blob as the product aggregate (courses **and** users, sessions, orders, subscriptions, entitlements, …)
4. Run pending `db/data-migrations/*` in memory. Undeclared writes to users/orders/entitlements **throw** and `ROLLBACK`
5. On `--apply`: `UPDATE app_files SET content=…, byte_size=…, updated_at=NOW() WHERE path='learning_guide/product.json'` then `COMMIT`

`--boot` skips the laptop confirm flags so DEV (`APP_ENV=DEV`) and SIT (`APP_ENV=SIT`) App Runner can persist. UAT and PPE/PROD skip persist even on boot. GitHub Actions never write SIT RDS; SIT start applies the same SHA against **SIT** `app_files`. Current seed `001_add_stoicism` inserts a published Stoicism course when that id/slug is missing.

`tsx` and `tsconfig-paths` are production dependencies because App Runner `npm ci` with `NODE_ENV=production` would otherwise omit them and boot would fail before Next.js starts.

```sh
npm run data:migration:new -- add_roman_history
npm run data:migrate -- --dry-run
```

Push `dev`. App Runner executes pending ids on start. Applied ids are stored in `dataMigrations` (and `catalogueMigrations` for older rows). The same `apply` / optional `plan()` files are the input for the future SQL/S3 runner.
