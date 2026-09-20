# Data update direction (DEV)

DEV App Runner (`learning-guide-portal`, www + admin) tracks the **`dev`** branch and auto-deploys it. SIT stays a manual `Deploy SIT` dispatch.

Do not commit `data/` or replace cloud `product.json`. Users, sessions, orders and entitlements stay in the live aggregate.

## How AWS runs a data change

| Pattern | Use | This repo |
|---|---|---|
| **Migrate on boot** | Any product-aggregate change (courses, portal, plans, backfills) | **Default.** `npm start` → `scripts/start-with-data-migrations.cjs` → persist pending `db/data-migrations/*` → `next start`. A failed migration fails the revision. |
| **CI retry** | Dry-run or re-apply DEV without a new start | Optional **Sync catalogue** workflow (`workflow_dispatch` only). Needs `DEV_DATABASE_URL` and `DEV_DATA_S3_BUCKET`. |
| **Laptop `--cloud`** | Operator apply with local AWS/DB env | `CONFIRM_DATA_SYNC=learning-guide/dev` + `APP_ENV=DEV` + `DATA_S3_PREFIX=learning-guide/dev` |
| **SQL schema** | Postgres tables/constraints | `db/migrations/*.sql` only |
| **SIT bootstrap** | New SIT store, catalogue slice only | `scripts/provision-sit.mjs` (not everyday sync) |

## Add a migration

1. Create `db/data-migrations/00N_name.ts` with stable `id`, `description`, and `apply(data)`.
2. `apply` may change any field on the product aggregate. A second run must be a no-op. Skip when the target row already exists or already has the new value.
3. Append the module to `dataMigrations` in `db/data-migrations/index.ts`.
4. Commit and **push `dev`**. App Runner deploys that SHA and executes pending ids on start. Applied ids are stored in `dataMigrations` (and `catalogueMigrations` for older rows).

```sh
npm run data:migrate -- --dry-run
npm run data:migrate -- --apply
CONFIRM_DATA_SYNC=learning-guide/dev APP_ENV=DEV DATA_S3_PREFIX=learning-guide/dev \
  npm run data:migrate -- --apply --cloud
```

SIT does not auto-deploy. After a manual SIT release of the same SHA, SIT start applies migrations from that SHA.

## Do not

- Push data changes only to `main` and expect DEV to pick them up (DEV source is `dev`).
- Copy local `data/knowledge_system/learning_guide/product.json` over RDS.
- Sync users, sessions, orders, subscriptions or entitlements through these scripts.
