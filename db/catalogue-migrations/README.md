# Catalogue migrations

Git-owned course/portal seeds. They upsert **catalogue only**.

Never copy `users`, `sessions`, `orders`, `subscriptions`, or entitlements.

Add a numbered file (`002_….ts`), export `id`, `description`, and `apply`, then append it in `index.ts`. `apply` may insert a missing course by stable `id`/`slug`. It must skip when that course already exists.

```sh
npm run catalogue:migrate -- --dry-run
npm run catalogue:migrate -- --apply
npm run catalogue:migrate -- --export /tmp/catalogue.json
CONFIRM_CATALOGUE_SYNC=learning-guide/dev APP_ENV=DEV DATA_S3_PREFIX=learning-guide/dev npm run catalogue:migrate -- --dry-run --cloud
CONFIRM_CATALOGUE_SYNC=learning-guide/dev APP_ENV=DEV DATA_S3_PREFIX=learning-guide/dev npm run catalogue:migrate -- --apply --cloud
```

`--cloud` is DEV only. SIT stays manual. After a push to `dev`, App Runner also applies pending migrations in memory on the next catalogue read; `--apply` persists them.
