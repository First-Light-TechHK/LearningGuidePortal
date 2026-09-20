# How to write a data migration

This is the developer contract for changing **live product data** in git so AWS can execute it. Today the executable store is the Postgres `app_files` row `learning_guide/product.json` (plus S3 objects the VFS already owns). The same script shape is what we will compile into **SQL + S3** later. Write for that future now: a migration is a **logical transform with an explicit domain**, not a dump of `data/product.json`, and not a raw `query()` / `s3Put()` call.

Operator overview: [data-migrations.md](data-migrations.md).

## What AWS actually runs

1. You commit a numbered file under `db/data-migrations/` and **push `dev`**.
2. GitHub **Deploy DEV** starts App Runner for that SHA (DEV = `www` + `admin.ilovelearningguide.com`).
3. `npm start` runs `scripts/start-with-data-migrations.cjs`.
4. That process applies every **unrecorded** id, writes the aggregate in one transaction (`UPDATE app_files … WHERE path='learning_guide/product.json'`), then starts Next.js.
5. If apply throws, the revision fails health and does not serve the new code against a half-written store.

SIT does not auto-deploy. After a manual SIT release of the same SHA, SIT start applies ids that environment has not recorded. It does not copy DEV users or payments.

`main` is not auto-deployed. Optional retry without a new boot: GitHub **Sync catalogue** (`workflow_dispatch` only, never on push) or

```sh
npm run data:migrate -- --dry-run
npm run data:migrate -- --apply
CONFIRM_DATA_SYNC=learning-guide/dev APP_ENV=DEV DATA_S3_PREFIX=learning-guide/dev \
  npm run data:migrate -- --apply --cloud
```

`--cloud` is DEV only. It never replaces the whole document with a local file.

## Mental model (today → SQL/S3)

| Layer | Today | Later (do not invent a second style) |
|---|---|---|
| Script | `id`, `description`, `touches`, `apply(data, ctx)`, optional `plan()` | Same file, same `id` |
| Logical change | Mutate `ProductData` in `apply` | Same predicates and payloads |
| Persist | Runner writes `app_files.learning_guide/product.json` | Runner executes `plan().sql` and `plan().objects` |
| Ledger | `dataMigrations[]` (and legacy `catalogueMigrations[]`) on the aggregate | `data_migrations(id, applied_at)` table |
| Media | Prefer `public/…` URLs, or existing course-media ids | `plan().objects` copies repo files to the env S3 prefix |

**Rules that keep the conversion cheap**

- `apply` is a pure transform of the aggregate. Do **not** import `services/persistence/db`, `s3.ts`, `getPool`, or `fs` writes.
- Declare every protected domain you change in `touches`. The runner snapshots `users`, `sessions`, `accounts`, `orders`, `quotes`, `subscriptions`, `entitlements`, study, conversations, notifications, tokens and Stripe events. An undeclared change **throws**.
- Use stable business ids (`stoicism`, `epicureanism`), never `course_${Date.now()}_…`.
- Second run must be a no-op (`skip` if the row already exists or already has the new value).
- Put intended SQL/S3 in `plan()` as soon as you know it. The aggregate runner **records** plan sizes and does **not** execute them yet.

## File and id contract

- Path: `db/data-migrations/NNN_snake_case.ts`
- `export const id` **must equal** the filename without `.ts` (example: `002_add_roman_history`)
- `NNN` is three digits, monotonic. Do not reuse or renumber a shipped id.
- Register the module in `db/data-migrations/index.ts` **in numeric order**. The runner fails boot if a numbered file is missing from the list or the list names a file that is not on disk.
- Copy `db/data-migrations/_template.example.ts` or run:

```sh
npm run data:migration:new -- add_roman_history
```

That writes `002_add_roman_history.ts` (next free number) and appends it to `index.ts`. Then edit `apply`.

`_template.example.ts` is not a migration. Do not give it a `NNN_` prefix.

## Script shape

```ts
import type { ProductData } from "../../services/productStore";
import type { DataChange, DataMigrationContext } from "./types";

export const id = "002_add_roman_history";
export const description = "Add the published Roman History sibling course.";
export const touches = ["courses"] as const;

export function apply(data: ProductData, ctx: DataMigrationContext): DataChange[] {
  if (data.courses.some((course) => course.id === "roman-history" || course.slug === "roman-history")) {
    return [{ action: "skip", kind: "course", id: "roman-history", reason: "exists" }];
  }
  data.courses.push({
    id: "roman-history",
    slug: "roman-history",
    title: "Roman History",
    description: "…",
    category: "European Humanities",
    thumbnailPath: "/portal/course-book.jpg",
    status: "published",
    createdAt: ctx.now,
    updatedAt: ctx.now,
    sections: [/* at least one public lesson if the course is published */],
  });
  return [{ action: "add", kind: "course", id: "roman-history" }];
}

export function plan() {
  return {
    sql: [
      `-- INSERT INTO courses (id, slug, title, status) VALUES ('roman-history', 'roman-history', 'Roman History', 'published')
-- ON CONFLICT (id) DO NOTHING;`,
    ],
    objects: [
      // { key: "learning_guide/media/roman-history/cover.jpg", source: "public/portal/course-book.jpg", contentType: "image/jpeg" }
    ],
  };
}
```

`ctx.store` is `"aggregate"` today and will be `"sql"` for the future adapter. `ctx.dryRun` is true for `--dry-run`. `ctx.now` is an ISO timestamp; use it instead of `Date.now()` in ids.

`apply` may be `async`. Prefer sync unless you are reading a **repo** file to build a payload (still no S3 client).

### `touches` values

`courses` · `plans` · `portalContent` · `paymentSettings` · `catalogue` · `media` · `users` · `sessions` · `accounts` · `orders` · `quotes` · `subscriptions` · `entitlements` · `studyRecords` · `studyEvents` · `conversations` · `notifications` · `tokens` · `other`

Default catalogue work is `["courses"]`. Portal CMS copy is `["portalContent"]`. Price seed is `["plans"]` (and usually the existing Stripe confirm path, not a silent amount change).

Do **not** add `users` / `orders` / `entitlements` unless the change is an explicit backfill with its own review. Those rows are environment-specific.

## What to put in the payload

**Courses.** Stable `id`/`slug`, `status`, category, sections, lessons. A published course needs a public lesson if learners should preview it. Cover images: use a file already in `public/portal/…`. Do not point at a local `/api/course-media/…` id that exists only on your laptop.

**Portal content.** Patch `data.portalContent` fields; do not replace the object if you can avoid wiping banners an operator edited. Prefer “set this banner slot if empty”.

**Plans.** Insert by plan `id` if missing. Do not overwrite `amountMinor` / Stripe snapshots here; use `scripts/sync-stripe-sandbox.ts --cloud`.

**Media.** Seed binaries belong in `public/` (git, App Runner disk) or, later, `plan().objects`. Course-media in S3 is per environment; a migration must not assume your local asset ids exist on DEV.

**Users and payments.** Out of scope unless `touches` says so and the PR says why. Never copy local sessions or tokens.

## Tests you must add

Add a unit test next to `tests/unit/data-migrations.test.ts` (or a focused `tests/unit/data-migration-00N.test.ts`) that:

1. Starts from a fixture **without** the new row.
2. `await applyDataMigrations(fixture, [yourModule])` and asserts the add/update.
3. Runs a second time and asserts `skip` / no duplicate row.
4. Asserts `users` / `orders` lengths are unchanged unless you declared those domains.

The runner already rejects undeclared user/order writes. Registry tests fail CI if you add a `NNN_*.ts` file and forget `index.ts`.

```sh
npm run data:migrate -- --dry-run
npx tsc --noEmit
node --import tsx --require ./scripts/register-tsconfig-paths.cjs --test tests/unit/data-migrations.test.ts tests/unit/catalogue-migrations.test.ts
```

## Checklist before you push `dev`

- [ ] Filename, `id`, and `index.ts` entry match and are in order
- [ ] `description` is one factual sentence
- [ ] `touches` lists every protected domain you change
- [ ] `apply` skips when the target already exists
- [ ] No `Date.now()` in business ids
- [ ] No import of `persistence/db` or `s3`
- [ ] Images are `public/…` or documented `plan().objects`
- [ ] Unit test covers add + idempotent skip
- [ ] Dry-run JSON looks right (`applied` / `changes`)
- [ ] Push **`dev`**, not only `main`

## After the SQL/S3 cutover

We will keep these files. The boot runner will:

1. Read the ledger (`data_migrations` or today’s JSON array).
2. For each pending id, prefer `plan()` when `ctx.store === "sql"`: run `sql[]` in the same transaction as the ledger insert; put `objects[]` under `DATA_S3_PREFIX`.
3. Fall back to `apply()` only while the aggregate still exists.

That is why a script written today with stable ids, `touches`, and a sketched `plan()` does not have to be rewritten as a one-off SQL dump.
