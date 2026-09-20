# Data migrations

Numbered scripts in git. AWS App Runner runs them on **process start** (`npm start` → `scripts/start-with-data-migrations.cjs`), then starts Next.js. A failed migration fails the deploy.

This is the App Runner equivalent of “migrate on boot”. Other common AWS options we are **not** using as the default:

- GitHub Action after deploy (`Sync catalogue`) — optional retry, needs DB secrets
- One-off Lambda / `provision-sit.mjs` — environment bootstrap only
- `db/migrations/*.sql` — Postgres schema, not the product aggregate

A migration may change any field in `product.json` (courses, portal content, plans, backfills). Write it so a second run is a no-op. Recorded ids live in `dataMigrations` (and `catalogueMigrations` for older rows).

```ts
// db/data-migrations/002_example.ts
export const id = "002_example";
export const description = "Backfill a field.";
export function apply(data) {
  // mutate data, return [{ action: "update", kind: "plans", id: "…" }]
}
```

Register the file in `index.ts`. Push to `dev`. App Runner deploys and executes it.

```sh
npm run data:migrate -- --dry-run
npm run data:migrate -- --apply
CONFIRM_DATA_SYNC=learning-guide/dev APP_ENV=DEV DATA_S3_PREFIX=learning-guide/dev npm run data:migrate -- --apply --cloud
```

`--cloud` is a laptop/operator path to DEV only. SIT still deploys manually; once that SHA is on SIT, SIT start also applies pending migrations from that SHA.
