# Data migration examples (start here)

If you have never written a migration: you are adding a **small TypeScript file** that says “if this row is missing, insert it”. You do **not** write SQL. You do **not** commit `data/product.json`. You do **not** need the DEV database password.

AWS on DEV reads that file on the next App Runner start, runs it through an in-memory ORM, then **maps** the writes to SQL + S3. CI runs the same file with a fake memory store so the build can fail before AWS ever sees it.

Contract and rules: [writing-data-migrations.md](writing-data-migrations.md).  
Operator overview: [data-migrations.md](data-migrations.md).  
Copy-paste sources: `db/data-migrations/examples/` (teaching files — **not** registered).

The live seed you can read end-to-end is [`db/data-migrations/001_add_stoicism.ts`](../../db/data-migrations/001_add_stoicism.ts).

---

## 15-minute first migration

You want a second published course on DEV. Do this exactly.

### 1. Create the file from the repo root

```sh
cd LearningGuide
git checkout dev
git pull
npm run data:migration:new -- add_roman_history
```

That prints something like `{ "id": "002_add_roman_history", "file": "db/data-migrations/002_add_roman_history.ts" }` and appends the module to `db/data-migrations/index.ts`. **Do not invent the number.** The next free `NNN` is chosen for you.

If you already have `002_…`, the command will make `003_…`. That is correct.

### 2. Open the new file and replace `apply`

Copy [`db/data-migrations/examples/add-published-course.ts`](../../db/data-migrations/examples/add-published-course.ts). Change only:

- `export const id` — must equal the filename without `.ts` (`002_add_roman_history`)
- `description` — one factual sentence
- the course `id` / `slug` / titles / lesson bodies

Leave `touches = ["courses"]`. A course row lives on the product catalogue. That is the `courses` domain.

### 3. Why the `if (exists) return skip` block is required

App Runner will start many times. The same file must be safe on the second, third, and hundredth boot.

- First boot: Stoicism is missing → `insert` → return `{ action: "add" }`.
- Later boots: the row is already there → return `{ action: "skip" }` and do not insert again.

If you skip that check, the second boot throws `Duplicate id roman-history` and the revision goes unhealthy.

### 4. Write a unit test (no database)

Create `tests/unit/data-migration-002-add-roman-history.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyOrmMigrations, createMemoryOrm } from "../../services/dataMigrations";
import * as addRomanHistory from "../../db/data-migrations/002_add_roman_history";

test("adds Roman History once and then skips", async () => {
  const orm = createMemoryOrm();
  const first = await applyOrmMigrations(orm, [addRomanHistory], { store: "memory" });
  const second = await applyOrmMigrations(orm, [addRomanHistory], { store: "memory" });
  assert.deepEqual(first.applied, ["002_add_roman_history"]);
  assert.equal(orm.table("courses").findById("roman-history")?.title, "Roman History");
  assert.deepEqual(second.applied, []);
  assert.equal(orm.table("users").all().length, 0);
  assert.equal(process.env.DATABASE_URL || "", "");
});
```

Run:

```sh
npx tsc --noEmit
node --import tsx --require ./scripts/register-tsconfig-paths.cjs --test \
  tests/unit/data-migration-002-add-roman-history.test.ts \
  tests/unit/data-migrations.test.ts
npm run data:migrate -- --dry-run
```

Dry-run should list your id under `applied` or `changes` on a laptop store that does not already have the course. It will also print `sql` / `objects` counts — that is the compiled AWS plan, not something you wrote.

### 5. Push `dev`, not `main`

```sh
git add db/data-migrations/002_add_roman_history.ts db/data-migrations/index.ts tests/unit/data-migration-002-add-roman-history.test.ts
git commit -m "Add Roman History catalogue course."
git push origin dev
```

GitHub **Deploy DEV** starts App Runner. `npm start` runs pending ids. After a healthy deploy, `www.ilovelearningguide.com` catalogue should show the new course.

SIT does not get this until someone runs **Deploy SIT**. SIT then applies the same file against **SIT** data. It does not copy DEV users.

---

## What you are allowed to call

`apply(orm, ctx)` talks only to `orm`. Three tools:

| Call | Use when | Row shape |
|---|---|---|
| `orm.table<T>("name")` | many rows with an `id` | `{ id: string, … }` |
| `orm.doc<T>("name")` | one document (portal, payment settings) | any object |
| `orm.files` | markdown / json / binary blobs | stable path string |

Table helpers: `all()`, `findById(id)`, `find(fn)`, `insert(row)`, `update(id, patch)`, `upsert(row)`.

Document helpers: `get()`, `set(value)` (replaces the whole object — usually wrong), `patch({ … })` (merge — usually right).

File helpers: `readText`, `readJson`, `writeText`, `writeJson`, `exists`.

`ctx.now` is an ISO timestamp. Use it for `createdAt` / `updatedAt`. Never put `Date.now()` in a business id.

`ctx.store` is `"memory"` in CI, `"aggregate"` on a laptop persist, `"sql"` when AWS compiles and executes. **You almost never branch on it.** Same `apply` everywhere.

---

## Example A — add a published course

**When:** a new course should appear on the DEV catalogue and in trial recommendations.

**Copy:** [`examples/add-published-course.ts`](../../db/data-migrations/examples/add-published-course.ts)  
**Live original:** [`001_add_stoicism.ts`](../../db/data-migrations/001_add_stoicism.ts)

```ts
export const touches = ["courses"] as const;

export function apply(orm: MigrationOrm, ctx: DataMigrationContext): DataChange[] {
  const courses = orm.table<ProductCourse>("courses");
  if (courses.find((course) => course.id === "roman-history" || course.slug === "roman-history").length) {
    return [{ action: "skip", kind: "course", id: "roman-history", reason: "exists" }];
  }
  courses.insert(romanHistoryCourse(ctx.now));
  return [{ action: "add", kind: "course", id: "roman-history" }];
}
```

**Field rules beginners miss**

- `id` and `slug` are stable English kebab-case (`roman-history`). They are never `course_1726…`.
- `status: "published"` plus at least one `isPublic: true` lesson, or visitors cannot preview.
- `thumbnailPath` must be a file already in `public/` (example: `/portal/course-book.jpg`). A local `/api/course-media/…` id from your laptop does not exist on DEV.
- `category` is one of `"Chinese Humanities" | "European Humanities" | "Science"`.
- AWS persist: this write updates `app_files.learning_guide/product.json` (the live app still reads courses from that blob). You still do **not** write that SQL yourself.

**Do not** also touch `users`, `orders`, or `entitlements`. Learners on DEV already have those rows.

---

## Example B — add a lesson to a course that already exists

**When:** Stoicism (or any course) is already on DEV and you only need one more lesson.

**Copy:** [`examples/add-lesson-to-course.ts`](../../db/data-migrations/examples/add-lesson-to-course.ts)

```ts
export const touches = ["courses"] as const;

export function apply(orm: MigrationOrm, ctx: DataMigrationContext): DataChange[] {
  const courses = orm.table<ProductCourse>("courses");
  const course = courses.findById("stoicism");
  if (!course) return [{ action: "skip", kind: "course", id: "stoicism", reason: "missing" }];
  if (course.sections.some((section) => section.lessons.some((item) => item.id === "daily-impressions-drill"))) {
    return [{ action: "skip", kind: "lesson", id: "daily-impressions-drill", reason: "exists" }];
  }
  const section = course.sections.find((item) => item.id === "stoic-foundations");
  if (!section) return [{ action: "skip", kind: "section", id: "stoic-foundations", reason: "missing" }];
  courses.update("stoicism", {
    updatedAt: ctx.now,
    sections: course.sections.map((item) => (
      item.id === "stoic-foundations"
        ? { ...item, lessons: [...item.lessons, lesson] }
        : item
    )),
  });
  return [{ action: "update", kind: "lesson", id: "daily-impressions-drill" }];
}
```

**Why `update` and not `insert`:** the course row already exists. You are changing it. Returning `{ action: "update" }` is what the runner counts as “applied”.

**Why three skip reasons:** on a fresh memory test the course may be missing; on DEV the lesson may already be there; a renamed section should not create a duplicate course.

If the section id is wrong, fix the migration — do not insert a second Stoicism course.

---

## Example C — patch portal copy only when empty

**When:** you want a default support URL (or a banner slot) without overwriting what an operator already typed on admin.

**Copy:** [`examples/patch-portal-banner-if-empty.ts`](../../db/data-migrations/examples/patch-portal-banner-if-empty.ts)

```ts
export const touches = ["portalContent"] as const;

export function apply(orm: MigrationOrm, ctx: DataMigrationContext): DataChange[] {
  const doc = orm.doc<PortalContent>("portalContent");
  const current = doc.get();
  if (!current) return [{ action: "skip", kind: "portalContent", id: "portalContent", reason: "missing" }];
  if (current.supportUrl?.trim()) {
    return [{ action: "skip", kind: "portalContent", id: "supportUrl", reason: "operator-set" }];
  }
  doc.patch({ supportUrl: "https://www.ilovelearningguide.com/support" });
  return [{ action: "update", kind: "portalContent", id: "supportUrl" }];
}
```

**`patch` vs `set`:** `set` replaces the whole portal document and can wipe bilingual banners. `patch` merges one field.

To fill an empty English banner slot (only if that slot has no title):

```ts
const banners = current.banners["en-GB"] || [];
if (banners[0]?.title) return [{ action: "skip", kind: "banner", id: "en-GB-0", reason: "operator-set" }];
doc.patch({
  banners: {
    ...current.banners,
    "en-GB": [
      { image: "/portal/auth-library.jpg", eyebrow: "LEARNING GUIDE", title: "…", text: "…", cta: "Explore courses", href: "/en-GB/portal/courses" },
      ...banners.slice(1),
    ],
  },
});
```

Images still come from `public/portal/…`.

---

## Example D — wiki page + markdown file (not a product column)

**When:** the data is not a course / plan / user. Knowledge pages, wiki nodes, extra catalogues.

**Copy:** [`examples/add-wiki-page.ts`](../../db/data-migrations/examples/add-wiki-page.ts)

```ts
export const touches = ["other", "files"] as const;

export function apply(orm: MigrationOrm, ctx: DataMigrationContext): DataChange[] {
  const pages = orm.table<{ id: string; title: string; courseId: string; updatedAt: string }>("wiki_pages");
  if (pages.findById("public-policy") && orm.files.exists("courses/economics/knowledge/public-policy/wiki/page.md")) {
    return [{ action: "skip", kind: "wiki_pages", id: "public-policy", reason: "exists" }];
  }
  if (!pages.findById("public-policy")) {
    pages.insert({ id: "public-policy", title: "Public policy", courseId: "economics", updatedAt: ctx.now });
  }
  if (!orm.files.exists("courses/economics/knowledge/public-policy/wiki/page.md")) {
    orm.files.writeText(
      "courses/economics/knowledge/public-policy/wiki/page.md",
      "# Public policy\n\nA first knowledge page seeded by a data migration.\n",
    );
  }
  return [{ action: "add", kind: "wiki_pages", id: "public-policy" }];
}
```

**`touches` you must declare**

- `"other"` — any table that is not a product column (`wiki_pages`, `knowledge_nodes`, …)
- `"files"` — any `orm.files.writeText` / `writeJson`

Forget either one and boot **throws** (CI will catch it).

**What AWS does with this script**

| Your call | Compiled persist |
|---|---|
| `pages.insert({ id: "public-policy", … })` | `INSERT INTO orm_rows (table_name, id, payload) …` |
| `orm.files.writeText("….md", …)` | `INSERT INTO app_files` with `storage='db'` (markdown is small text) |
| `orm.files.writeText("cover.png", …)` | S3 object under `DATA_S3_PREFIX/learning_guide/orm/…` plus an `app_files` pointer |
| runner records the migration id | `INSERT INTO data_migrations (id) VALUES ('093_…')` |

You never write those SQL strings. CI asserts they were compiled (`report.sql > 0`).

---

## Example E — backfill a settings document

**When:** a display name or flag is wrong on every environment and you can say the exact old value.

**Copy:** [`examples/backfill-payment-settings.ts`](../../db/data-migrations/examples/backfill-payment-settings.ts)

```ts
export const touches = ["paymentSettings"] as const;

export function apply(orm: MigrationOrm): DataChange[] {
  const settings = orm.doc<{ name: string }>("paymentSettings");
  if (settings.get()?.name === "Learning Guide Stripe") {
    return [{ action: "skip", kind: "paymentSettings", id: "paymentSettings", reason: "current" }];
  }
  settings.patch({ name: "Learning Guide Stripe" });
  return [{ action: "update", kind: "paymentSettings", id: "paymentSettings" }];
}
```

Do **not** change `amountMinor`, Stripe price ids, or publishable keys here. Those go through `scripts/sync-stripe-sandbox.ts --cloud`.

---

## Example F — what you must not ship

These fail CI or destroy live data. They are shown so you can recognise them in review.

```ts
// WRONG — SQL in the script. CI has no DATABASE_URL.
await db.query("INSERT INTO courses …");

// WRONG — mutate ProductData by hand.
data.courses.push(course);

// WRONG — unstable id. Second boot inserts another row.
courses.insert({ id: `course_${Date.now()}`, … });

// WRONG — forgot touches: ["other"].
orm.table("wiki_pages").insert({ id: "x" });

// WRONG — forgot touches: ["files"].
orm.files.writeText("wiki/x.md", "# x\n");

// WRONG — copies laptop users onto DEV.
orm.table("users").insert(localUser);
// unless the PR is an explicit backfill and touches includes "users"

// WRONG — overwrites operator banners.
orm.doc("portalContent").set(defaultPortalContent);

// WRONG — registered in index.ts but file not committed, or the reverse.
```

---

## Which `touches` do I write?

Pick every domain you change. The runner snapshots protected tables and extra tables before `apply` and **throws** if something moved without a declaration.

| You change | `touches` |
|---|---|
| New / updated course or lesson | `["courses"]` |
| Plan row (id only, no silent price change) | `["plans"]` |
| Portal banners / support URL | `["portalContent"]` |
| Payment display document | `["paymentSettings"]` |
| Extra table (`wiki_pages`, …) | `["other"]` |
| `orm.files.write…` | `["files"]` or `["media"]` |
| Wiki row **and** markdown | `["other", "files"]` |
| Users / orders / entitlements | almost never; needs review |

`catalogue` is a legacy alias for “catalogue-shaped work”. Prefer `courses` / `plans` / `portalContent` so the declaration matches what you touch.

---

## How to test (copy this shape)

Every new numbered file needs a test. CI has no Postgres.

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyOrmMigrations, createMemoryOrm } from "../../services/dataMigrations";
import * as migration from "../../db/data-migrations/00N_your_name";

test("00N_your_name is idempotent and does not touch users", async () => {
  const orm = createMemoryOrm({
    // seed only what apply() must already see; leave empty if it inserts a new course
    tables: { /* courses: [existingCourse] */ },
    docs: { /* portalContent: { supportUrl: "", banners: { "en-GB": [], "zh-CN": [] }, categories: [], countries: [] } */ },
  });
  const first = await applyOrmMigrations(orm, [migration], { store: "memory" });
  const second = await applyOrmMigrations(orm, [migration], { store: "memory" });
  assert.ok(first.applied.includes(migration.id) || first.changes.some((item) => item.action === "skip"));
  assert.deepEqual(second.applied, []);
  assert.equal(orm.table("users").all().length, 0);
  assert.equal(process.env.DATABASE_URL || "", "");
});
```

If you wrote extra tables or files, also assert:

```ts
assert.equal(orm.table("wiki_pages").findById("public-policy")?.title, "Public policy");
assert.match(orm.files.readText("courses/economics/knowledge/public-policy/wiki/page.md") || "", /Public policy/);
assert.ok(first.sql >= 1); // compiled AWS plan exists even though CI did not connect
```

---

## What happens after you push `dev`

```
you: 002_add_roman_history.ts + index.ts + unit test
        │
        ▼
git push origin dev
        │
        ▼
GitHub Actions  Deploy DEV  (not main)
        │
        ▼
App Runner npm start
        │
        ├─ apply(orm) in memory against live DEV data
        ├─ compile ops → SQL + S3 plan
        ├─ BEGIN
        ├─ INSERT data_migrations / orm_rows / app_files
        ├─ S3 put for binary/large files
        ├─ UPDATE learning_guide/product.json if a product table changed
        └─ COMMIT  or  ROLLBACK + unhealthy revision
```

If apply throws, learners never see a half-written store. Fix the script, push `dev` again. Do not “edit the row in RDS by hand” to unblock — the ledger and the row must stay consistent.

---

## Checklist (print this next to the PR)

- [ ] I used `npm run data:migration:new`, I did not pick a number by hand
- [ ] Filename, `export const id`, and `index.ts` match
- [ ] `description` is one sentence a reviewer can check on DEV
- [ ] `touches` lists every domain I change
- [ ] `apply` returns `skip` when the target already exists
- [ ] Business ids are stable kebab-case
- [ ] No SQL, no `getPool`, no `s3.ts`, no `fs` write to the live store
- [ ] Cover images are `public/…` paths
- [ ] Unit test: add (or update) + second run skip + users untouched
- [ ] `npx tsc --noEmit` and the unit test pass
- [ ] I pushed **`dev`**
