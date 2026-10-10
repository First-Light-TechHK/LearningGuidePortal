# Updating lesson summaries across versions

Ship the summary types, service validation, bilingual editor, curriculum rendering and migration registry together. The optional field is stored in the existing course aggregate; no SQL schema change is required.

`db/data-migrations/005_backfill_lesson_summaries.ts` writes the confirmed introduction for `horatius-lesson-21`. It only fills missing/blank summaries, preserves all teaching content and existing author summaries, and skips missing lessons. Other lessons stay blank until an author supplies their introductions.

Preview pending migrations using the configured local store:

```sh
npm run data:migrate -- --dry-run
```

Write to that local store:

```sh
npm run data:migrate -- --apply
```

These commands run all pending registered migrations, not only 005. DEV/SIT App Runner executes pending migrations on startup under the existing release rules. For cloud execution and UAT/PPE/PROD follow [the migration policy](data-migrations.md) and [release runbook](release-runbook.md); a local apply does not update a remote environment.

For later introduction updates, scaffold a new migration with `npm run data:migration:new -- update_lesson_summaries`, copy the 005 pattern and supply reviewed course IDs, lesson IDs and summary strings. Do not edit an already shipped migration: each environment records its ID once. For deliberately replacing an existing summary, guard against the expected old value instead of overwriting author edits unconditionally.

Target-environment smoke: edit/save/reopen a draft lesson summary in both UI locales, publish using the normal workflow, then verify signed-out curriculum shows the introduction beside duration. Clear it and verify the description disappears. Confirm body/contents do not appear, stale edits fail, and 005 reruns without changing existing introductions. Figma screenshot acceptance remains pending.
