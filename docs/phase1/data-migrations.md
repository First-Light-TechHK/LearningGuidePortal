# Data update direction (DEV)

DEV App Runner (`learning-guide-portal`, www + admin) tracks the **`dev`** branch. A push to **`dev`** runs GitHub **Deploy DEV**, which starts that service. **`main` is not the auto-sync source.** SIT stays a manual `Deploy SIT` dispatch.

**New to this:** [data-migration-examples.md](data-migration-examples.md) (copy-paste walkthrough).  
**Rules:** [writing-data-migrations.md](writing-data-migrations.md).  
**Standard data model:** [domain-model.md](domain-model.md) (`docs/phase1/domain-model.md`, not a GitHub `/blob/` URL).

Do not commit `data/` or replace cloud `product.json`. Do not put SQL in a data migration — CI has no `DATABASE_URL`. Users, sessions, orders and entitlements stay in the live store unless a migration declares those `touches` and is reviewed as a backfill.

## How AWS runs a data change

| Pattern | Use | This repo |
|---|---|---|
| **ORM on boot** | Any live-data change (courses, portal, wiki, files, backfills) | **Default.** Push **`dev`** → GitHub **Deploy DEV** → App Runner start. `npm start` compiles `apply(orm)` into SQL + S3 and executes that plan, then `next start`. A failed migration fails the revision. |
| **Memory ORM in CI** | Prove the script and the SQL/S3 mapping without a database | `createMemoryOrm()` + compiled plan. No DB vars. |
| **CI retry** | Dry-run or re-apply DEV without a new start | Optional **Sync catalogue** workflow (`workflow_dispatch` only, never on push). Checks out **`dev`**. Needs `DEV_DATABASE_URL` and `DEV_DATA_S3_BUCKET` on the workflow, not in unit tests. |
| **Laptop `--cloud`** | Operator apply with local AWS/DB env | `CONFIRM_DATA_SYNC=learning-guide/dev` + `APP_ENV=DEV` + `DATA_S3_PREFIX=learning-guide/dev` |
| **SQL schema** | Postgres tables/constraints | `db/migrations/*.sql` only — never data seeds. Data scripts do not ALTER tables. |
| **SIT bootstrap** | New SIT store, catalogue slice only | `scripts/provision-sit.mjs` (not everyday sync) |

## What boot persist actually writes

This is **not** a hand-written SQL seed. On DEV/SIT App Runner compiles the ORM script and writes **that environment’s own RDS + S3**:

1. `BEGIN`
2. `SELECT storage, content FROM app_files WHERE path = 'learning_guide/product.json' FOR UPDATE`
3. Hydrate `orm_rows` / `data_migrations` into the ORM, then run pending `apply(orm)` scripts. Undeclared writes to users/orders/entitlements **throw** and `ROLLBACK`
4. Compile those ORM ops: product tables and extra tables → `orm_rows`, files → `app_files` (and S3 when binary/large), ledger → `data_migrations`
5. On `--apply`: execute that SQL/S3 plan, snapshot every product table/doc into `orm_rows`, then `UPDATE app_files SET content=… WHERE path='learning_guide/product.json'` and `COMMIT`

`--boot` skips the laptop confirm flags so DEV (`APP_ENV=DEV`) and SIT (`APP_ENV=SIT`) App Runner can persist. UAT and PPE/PROD skip persist even on boot. GitHub Actions never write SIT RDS; SIT start applies the same SHA against **SIT** `app_files`. Current seed `001_add_stoicism` inserts a published Stoicism course when that id/slug is missing.

`tsx` and `tsconfig-paths` are production dependencies because App Runner `npm ci` with `NODE_ENV=production` would otherwise omit them and boot would fail before Next.js starts.

```sh
npm run data:migration:new -- add_roman_history
npm run data:migrate -- --dry-run
```

Push `dev`. App Runner compiles pending ORM scripts on start and executes the SQL/S3 plan. Applied ids are stored in `data_migrations` (and `dataMigrations` / `catalogueMigrations` on the aggregate). Extra tables live in `orm_rows`; files live in `app_files` / S3.
