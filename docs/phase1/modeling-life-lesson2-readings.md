# Modeling life Lesson 02 Reading list

User request (2026-10-29): copy the three Lesson 01 readings to Lesson 02, advancing the two numeric ranges without changing their spans.

| Reading | Lesson 01 | Lesson 02 |
| --- | --- | --- |
| Garfinkel, Shevtsov, Guo: Modeling Life | pp 16 – 23 (8 pages) | pp 24 – 31 (8 pages) |
| MIT Open Courseware, Feeedback and Control Systems, State Space: Linear Systems | lectures 9-13 (5 lectures) | lectures 14-18 (5 lectures) |
| Wikipedia, State Space Representation | Same entry | Same entry |

`018_add_modeling_life_lesson2_readings` is registered after 017 and uses only the courses ORM. It copies the current Lesson 01 entries with stable new ids `modeling-life-l2-reading-1` through `-3` and `lessonNumber: "02"`. All other source fields and wording are retained. It fills only an empty/missing Lesson 02 list; existing nonempty lists skip. Missing target Course/Lesson skips without recreating it; conflicting identities, missing/duplicate source entries and changed source numeric ranges fail before any write. The existing migration ledger and populated-list guard make retries safe.

Only Lesson 02 readings and the Course update timestamp change. Lesson 01, content/media, preview configuration, Exhibits, assessment definitions, saved answers, Study, Orders, Payments, Subscriptions and Entitlements remain unchanged. No API, database schema, UI translation or layout change is needed. This request supersedes the original import's intentionally empty Lesson 02 Reading list.

Validation uses disposable memory ORM and local browser fixtures: exact copied content and ranges, compiled persistence plan, registry order, fresh/existing imports, direct and ledger replay, preservation of operator lists/exhibits/learner history, conflicts with no partial writes, and bilingual This lesson/Whole course views on desktop/mobile. Screenshots are under `test-results/modeling-life/browser/*-lesson-2-reading-list-*.png`.

Local validation passed: all 29 focused migration/service/API/browser regressions (including the updated fresh-registry expectation), scoped ESLint and `npm run build`. English desktop and Chinese mobile Lesson 02 Reading list screenshots were inspected. No live data was migrated.

The normal release applies migration 018 to each target environment independently. Check both the report/ledger and rendered data; successful startup alone does not prove migration execution. Target execution and smoke remain pending deployment. Correct future data through a new numbered migration, preserving intervening operator edits and all learner records; do not edit shipped migrations or delete their ledger entries.
