# How to write a data migration

This is the developer contract for changing **live data** in git so AWS can execute it. A migration is **not** a SQL script and **not** a dump of `data/product.json`. You write against an in-memory **ORM**. CI can run that ORM with no `DATABASE_URL`. AWS on DEV is the only place that persists.

Operator overview: [data-migrations.md](data-migrations.md).

## Why ORM, not SQL, in this layer

CI/CD tests **cannot** see the DEV database. Those variables stay on App Runner / operator machines. A `.sql` file would only be executable on DEV by AWS, so it cannot be unit-tested.

So:

| Layer | Who runs it | What you write |
|---|---|---|
| **Migration script** | CI, laptop dry-run, App Runner boot | `apply(orm, ctx)` — table / doc / files API |
| **Memory ORM** | `npm test`, `data:migrate --dry-run` without DB | `createMemoryOrm()` — no Postgres, no S3 |
| **Compiler** | CI and AWS | Same ops → `data_migrations` / `orm_rows` / `app_files` SQL + S3 objects |
| **SQL / S3 execute** | DEV/SIT App Runner only | `scripts/migrate-data.ts --apply --boot` runs the compiled plan. **Do not hand-write SQL in the migration.** |

AWS maps the ORM ops. If you put SQL in the script, CI cannot prove it.

## What AWS actually runs

1. You commit a numbered file under `db/data-migrations/` and **push `dev`**.
2. GitHub **Deploy DEV** starts App Runner for that SHA (DEV = `www` + `admin.ilovelearningguide.com`). `main` is not auto-deployed.
3. `npm start` runs `scripts/start-with-data-migrations.cjs`.
4. That process opens the live store, builds an ORM over it, applies every **unrecorded** id, compiles those ops to SQL/S3, executes the plan in one transaction, then starts Next.js.
5. If apply throws, the revision fails health and does not serve the new code against a half-written store.

SIT does not auto-deploy. After a manual SIT release of the same SHA, SIT start applies ids that environment has not recorded. It does not copy DEV users or payments.

Optional retry without a new boot: GitHub **Sync catalogue** (`workflow_dispatch` only, never on push) or

```sh
npm run data:migrate -- --dry-run
npm run data:migrate -- --apply
CONFIRM_DATA_SYNC=learning-guide/dev APP_ENV=DEV DATA_S3_PREFIX=learning-guide/dev \
  npm run data:migrate -- --apply --cloud
```

`--cloud` is DEV only. It never replaces the whole document with a local file.

## Mental model

| Layer | CI / laptop | AWS DEV/SIT boot |
|---|---|---|
| Script | `id`, `description`, `touches`, `apply(orm, ctx)` | Same file, same `id` |
| Logical change | `orm.table` / `orm.doc` / `orm.files` | Same predicates and payloads |
| Prove it | `createMemoryOrm()` compiles the SQL/S3 plan | Same compile, then execute |
| Persist | Dry-run prints `sql` / `objects` counts | Extra tables → `orm_rows`; files → `app_files` + S3; product tables → `learning_guide/product.json`; ledger → `data_migrations` |

**Rules that keep the conversion cheap**

- Talk only to `orm`. Do **not** import `services/persistence/db`, `s3.ts`, `getPool`, or write SQL / `fs` to the live store.
- Do **not** mutate `ProductData` by hand. Product rows are `orm.table("courses")` (or `plans`, `users`, …). CMS / settings are `orm.doc("portalContent")` / `orm.doc("paymentSettings")`. Everything else is `orm.table("your_table")` or `orm.files`.
- Declare every protected domain you change in `touches`. Undeclared user / order / session / entitlement writes **throw**. Extra tables need `other`. File writes need `files` or `media`.
- Use stable business ids (`stoicism`, `public-policy`), never `course_${Date.now()}`.
- Second run must be a no-op (`skip` if the row or file already exists).

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
import type { MigrationOrm } from "../../services/migrationOrm";
import type { DataChange, DataMigrationContext } from "./types";

export const id = "002_add_roman_history";
export const description = "Add the published Roman History sibling course.";
export const touches = ["courses"] as const;

export function apply(orm: MigrationOrm, ctx: DataMigrationContext): DataChange[] {
  const courses = orm.table<{ id: string; slug: string; title: string; status: string; createdAt: string }>("courses");
  if (courses.find((course) => course.id === "roman-history" || course.slug === "roman-history").length) {
    return [{ action: "skip", kind: "course", id: "roman-history", reason: "exists" }];
  }
  courses.insert({
    id: "roman-history",
    slug: "roman-history",
    title: "Roman History",
    status: "published",
    createdAt: ctx.now,
    // …full ProductCourse fields
  });
  return [{ action: "add", kind: "course", id: "roman-history" }];
}
```

Non-product data (wiki pages, knowledge nodes, anything that is not a `ProductData` column):

```ts
export const touches = ["other", "files"] as const;

export function apply(orm: MigrationOrm, ctx: DataMigrationContext): DataChange[] {
  const pages = orm.table<{ id: string; title: string }>("wiki_pages");
  if (pages.findById("public-policy")) {
    return [{ action: "skip", kind: "wiki_pages", id: "public-policy", reason: "exists" }];
  }
  pages.insert({ id: "public-policy", title: "Public policy" });
  orm.files.writeText("courses/economics/knowledge/public-policy/wiki/page.md", "# Public policy\n");
  void ctx;
  return [{ action: "add", kind: "wiki_pages", id: "public-policy" }];
}
```

`ctx.store` is `"memory"` in CI and `"aggregate"` on App Runner persist today. A later SQL adapter will keep the same `apply(orm)` and change only the ORM implementation. `ctx.dryRun` is true for `--dry-run`. `ctx.now` is an ISO timestamp; use it instead of `Date.now()` in ids.

`apply` may be `async`. Prefer sync unless you are reading a **repo** file to build a payload (still no S3 client).

### ORM surface

- `orm.table<T>(name)` — `all`, `findById`, `find`, `insert`, `update`, `upsert`. Rows need an `id: string`.
- `orm.doc<T>(name)` — `get`, `set`, `patch` for singleton documents (`portalContent`, `paymentSettings`, or your own).
- `orm.files` — `readText`, `readJson`, `writeText`, `writeJson`, `exists`.

Product table names today: `courses`, `plans`, `users`, `sessions`, `accounts`, `orders`, `quotes`, `subscriptions`, `entitlements`, `studyRecords`, `studyEvents`, `conversations`, `notifications`, `verificationTokens`, `passwordResetTokens`, `emailBindingTokens`, `stripeEvents`, `orderActivities`.

Anything else is an extra table. On DEV persist it is stored under `ormExtras` on the aggregate until the SQL adapter exists. CI never needs that bag — use `createMemoryOrm()`.

### `touches` values

`courses` · `plans` · `portalContent` · `paymentSettings` · `catalogue` · `files` · `media` · `users` · `sessions` · `accounts` · `orders` · `quotes` · `subscriptions` · `entitlements` · `studyRecords` · `studyEvents` · `conversations` · `notifications` · `tokens` · `other`

Default catalogue work is `["courses"]`. Portal CMS copy is `["portalContent"]`. Price seed is `["plans"]` (and usually the existing Stripe confirm path, not a silent amount change). Extra tables = `["other"]`. File / wiki / media blobs = `["files"]` or `["media"]`.

Do **not** add `users` / `orders` / `entitlements` unless the change is an explicit backfill with its own review. Those rows are environment-specific.

## What to put in the payload

**Courses.** Stable `id`/`slug`, `status`, category, sections, lessons. A published course needs a public lesson if learners should preview it. Cover images: use a file already in `public/portal/…`. Do not point at a local `/api/course-media/…` id that exists only on your laptop.

**Portal content.** `orm.doc("portalContent").patch({ … })`. Do not `set` the whole object if that would wipe banners an operator edited. Prefer “set this banner slot if empty”.

**Plans.** `orm.table("plans").insert` by plan `id` if missing. Do not overwrite `amountMinor` / Stripe snapshots here; use `scripts/sync-stripe-sandbox.ts --cloud`.

**Files / wiki / media.** `orm.files.writeText` / `writeJson` with a stable path. Seed binaries that the Next app must serve belong in `public/` (git, App Runner disk). Course-media in S3 is per environment; a migration must not assume your local asset ids exist on DEV.

**Users and payments.** Out of scope unless `touches` says so and the PR says why. Never copy local sessions or tokens.

## Tests you must add

CI has no database. Write the test against the memory ORM (or a fixture aggregate — still no `DATABASE_URL`):

1. `const orm = createMemoryOrm()` **or** a `ProductData` fixture without the new row.
2. `await applyOrmMigrations(orm, [yourModule], { store: "memory" })` and assert the add/update.
3. Run a second time and assert `skip` / no duplicate row.
4. Assert `users` / `orders` are unchanged unless you declared those domains.
5. If you touch extra tables or files, assert `orm.table("…")` / `orm.files.readText`.

The runner already rejects undeclared user/order writes. Registry tests fail CI if you add a `NNN_*.ts` file and forget `index.ts`.

```sh
npm run data:migrate -- --dry-run
npx tsc --noEmit
node --import tsx --require ./scripts/register-tsconfig-paths.cjs --test tests/unit/data-migrations.test.ts tests/unit/catalogue-migrations.test.ts
```

## Checklist before you push `dev`

- [ ] Filename, `id`, and `index.ts` entry match and are in order
- [ ] `description` is one factual sentence
- [ ] `touches` lists every protected domain you change (`other` / `files` when needed)
- [ ] `apply` uses the ORM and skips when the target already exists
- [ ] No `Date.now()` in business ids
- [ ] No SQL, no `persistence/db`, no `s3` client
- [ ] Images are `public/…` or `orm.files` paths
- [ ] Unit test covers add + idempotent skip **without** `DATABASE_URL`
- [ ] Dry-run JSON looks right (`applied` / `changes`)
- [ ] Push **`dev`**, not only `main`

## What AWS executes

On DEV/SIT boot (`npm start` → `--apply --boot`):

1. `CREATE TABLE IF NOT EXISTS data_migrations` and `orm_rows` (also `db/migrations/010_orm_runtime.sql`).
2. Lock `app_files.learning_guide/product.json`, hydrate extra rows from `orm_rows` and the SQL ledger.
3. Run `apply(orm)` with `ctx.store === "sql"`.
4. Compile the recorded ops and execute them in the same transaction:
   - product tables/docs → update the aggregate blob (the live app still reads it)
   - extra tables/docs → `INSERT … orm_rows ON CONFLICT`
   - ledger → `INSERT … data_migrations ON CONFLICT DO NOTHING`
   - small text files → `app_files` `storage='db'`
   - binary / large files → S3 under `DATA_S3_PREFIX/learning_guide/orm/…` plus an `app_files` pointer
5. Commit. A thrown apply or SQL/S3 error rolls back and fails the revision.

CI never reaches step 4. It stops at the compiled plan.
