# Modeling life Lesson 02 assessment import

Source: user-supplied `lesson 2-tests.xlsx`, SHA-256 `4960a37733a2d4bf6a5bca5433b2e2fbf343f9e553f082f93d55c1a1bf85e037`.

Migration: `db/data-migrations/015_add_modeling_life_lesson2_assessments.ts`, registered after 014 in `db/data-migrations/index.ts`. It uses the existing ORM migration API and declares only `touches: ["courses"]`.

## Source mapping

Target Course id/slug: `modeling-life`. Target Lesson id: `modeling-life-lesson-2` (Lesson 02).

| Excel source | Target |
| --- | --- |
| `knowledge test!A2:A9` | Verify every row belongs to Lesson 2 during extraction |
| `knowledge test!B2:B9` | Question order 1–8 |
| `knowledge test!C2:C9` | `assessments.knowledge[].prompt` |
| `knowledge test!D2:D9` | `assessments.knowledge[].referenceAnswer` |
| `application test!B2` | `assessments.application.paragraphs`, six original paragraphs split at blank lines |
| `application test!C2` | `assessments.application.reference`, preserving all eleven original paragraphs and step headings |

Knowledge IDs are `modeling-life-l2-knowledge-1` through `modeling-life-l2-knowledge-8`; Application id is `modeling-life-l2-application-1`. The supplied content is English only and stays English in either UI locale, using the existing authored-content model. No translations or answers are invented. The Application reference retains the neutral equilibrium, social-influence parameter, supercritical pitchfork, two stable opinions, four steps and conclusion.

Canonical source-content SHA-256 (ordered prompt/answer pairs, original Application question and answer): `7eadc4e9dcda8d851e7cc61892d71c39474fd85b727c16f5bce65b27d12b2c1c`. The regression compares the exported definitions against this independently extracted checksum; CI does not need the local workbook path. All payload text is embedded in the migration, so deployment does not read Excel or require a new dependency, database schema or S3 object.

## Update and retry behavior

The migration fills Knowledge only when its array is empty/missing and Application only when its definition is null/missing. Each existing nonempty definition is preserved, including partial backfills and operator-authored replacements. A fully configured Lesson skips with `assessments-exist`. Do not use this migration to replace an existing question set.

All other Course/Lesson fields stay unchanged, including Lesson 01, authored text/video points, media identities, Exploration, preview policy, title and ordering. Only the Course update timestamp advances. No user answers, Study records, Orders, Payments, Subscriptions or Entitlements are changed. A missing Course/Lesson skips without recreating it; conflicting Course slug or duplicate Lesson ids throws before writing. Normal registry order first creates/upgrades the Course through 008, then applies 015 to fresh and existing environments. The standard transaction records the unique migration id, so deployment replay does not duplicate or restore edited questions. Direct repeated application also skips a populated Lesson.

## Validation

```sh
node --import tsx --require ./scripts/register-tsconfig-paths.cjs --test tests/unit/modeling-life-lesson2-assessments.test.ts tests/unit/modeling-life-lesson2-assessment-api.test.ts tests/unit/modeling-life-migration.test.ts tests/unit/modeling-life-page.test.ts tests/unit/data-migrations.test.ts tests/unit/catalogue-migrations.test.ts
npm run data:migrate -- --dry-run
npm run typecheck
npm run build
```

Tests use memory ORM and disposable local users/storage. They cover exact source text/order and paragraphs, compiled migration operations, repeat runs, partial/operator definitions, unrelated history preservation, identity conflicts, real Lesson 02 GET/PUT, eight-response validation, duplicate request recovery, prerequisite sequencing, account ownership and expired Entitlement. Existing runtime regressions now expect four authored Course tests (two per Lesson); the original immutable 008 seed still deliberately has no Lesson 02 tests before 015 is applied.

Local validation passed: 31 migration/assessment service/API tests, the existing bilingual Modeling life browser test, both TypeScript configurations, scoped ESLint and `npm run build`. The local migration dry-run reports one Lesson 02 update (`knowledge:8,application:1`), two compiled SQL operations, zero S3 objects and `persisted:false`.

No source workbook is changed. The user has authorised committing and pushing to DEV. The standard DEV deployment processes pending migrations; target execution and smoke must be verified after deployment.

## Deployment smoke and rollback

When authorised for release, ship the new numbered file and registry entry together. Existing DEV/SIT `npm start` boot migration processing applies pending course changes to each environment's own database; SIT is a manual release of the intended revision. UAT/PPE follow their reviewed release procedure. Do not copy local `product.json` or user data to the cloud. Check the migration report and ledger, then inspect the target Lesson for 8/1 definitions. A successful site startup alone does not prove a migration ran, since the current startup wrapper can log a migration error and continue.

In both UI locales verify no Lesson 02 test starts before both Lesson 01 tests complete. After unlocking, Knowledge shows eight questions in the workbook's order and persists notes/ratings/retry. Application shows the park/public-opinion scenario and original reference after the existing server-timed review. Its sample UI must not invent a numeric AI grade. Understanding shows four total tests, retains prior Lesson 01 results and does not report new tests as completed. Check reload, retake, a second account, anonymous and expired access. Public previews must not include assessment answers. These target checks await deployment.

Application rollback retains the imported definitions and learner records. If definitions need correction/removal, create a separately reviewed migration after checking intervening author edits and learner attempts; do not edit shipped migrations, erase the ledger or delete user answers.
