# Data update direction (DEV)

DEV App Runner (`learning-guide-portal`, www + admin) tracks the **`dev`** branch. A push to **`dev`** runs GitHub **Deploy DEV**, which starts that service. **`main` is not the auto-sync source.** SIT stays a manual `Deploy SIT` dispatch.

**How to write a script:** [writing-data-migrations.md](writing-data-migrations.md).

Do not commit `data/` or replace cloud `product.json`. Do not put SQL in a data migration — CI has no `DATABASE_URL`. Users, sessions, orders and entitlements stay in the live store unless a migration declares those `touches` and is reviewed as a backfill.

## How AWS runs a data change

| Pattern | Use | This repo |
|---|---|---|
| **ORM on boot** | Any live-data change (courses, portal, wiki, files, backfills) | **Default.** Push **`dev`** → GitHub **Deploy DEV** → App Runner start. `npm start` → `scripts/start-with-data-migrations.cjs` → `apply(orm)` for pending `db/data-migrations/*` → persist → `next start`. A failed migration fails the revision. |
| **Memory ORM in CI** | Prove the script without a database | `createMemoryOrm()` + `applyOrmMigrations`. No DB vars. |
| **CI retry** | Dry-run or re-apply DEV without a new start | Optional **Sync catalogue** workflow (`workflow_dispatch` only, never on push). Checks out **`dev`**. Needs `DEV_DATABASE_URL` and `DEV_DATA_S3_BUCKET` on the workflow, not in unit tests. |
| **Laptop `--cloud`** | Operator apply with local AWS/DB env | `CONFIRM_DATA_SYNC=learning-guide/dev` + `APP_ENV=DEV` + `DATA_S3_PREFIX=learning-guide/dev` |
| **SQL schema** | Postgres tables/constraints | `db/migrations/*.sql` only — never data seeds. Data scripts do not ALTER tables. |
| **SIT bootstrap** | New SIT store, catalogue slice only | `scripts/provision-sit.mjs` (not everyday sync) |

## What boot persist actually writes

This is **not** a schema migration. On DEV/SIT it rewrites one JSON row in **that environment’s own RDS**:

1. `BEGIN`
2. `SELECT storage, content FROM app_files WHERE path = 'learning_guide/product.json' FOR UPDATE`
3. Build an ORM over the aggregate (product tables plus `ormExtras` for anything else)
4. Run pending `apply(orm)` scripts. Undeclared writes to users/orders/entitlements **throw** and `ROLLBACK`
5. On `--apply`: `UPDATE app_files SET content=…, byte_size=…, updated_at=NOW() WHERE path='learning_guide/product.json'` then `COMMIT`

`--boot` skips the laptop confirm flags so DEV (`APP_ENV=DEV`) and SIT (`APP_ENV=SIT`) App Runner can persist. UAT and PPE/PROD skip persist even on boot. GitHub Actions never write SIT RDS; SIT start applies the same SHA against **SIT** `app_files`. Current seed `001_add_stoicism` inserts a published Stoicism course when that id/slug is missing.

`tsx` and `tsconfig-paths` are production dependencies because App Runner `npm ci` with `NODE_ENV=production` would otherwise omit them and boot would fail before Next.js starts.

```sh
npm run data:migration:new -- add_roman_history
npm run data:migrate -- --dry-run
```

Push `dev`. App Runner executes pending ids on start. Applied ids are stored in `_data_migrations` / `dataMigrations` (and `catalogueMigrations` for older rows). Extra (non-product) tables and files live on `ormExtras` until a SQL/S3 adapter interprets the same ORM ops.
