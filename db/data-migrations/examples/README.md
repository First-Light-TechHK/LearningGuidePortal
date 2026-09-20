# Data migration examples

These files are **teaching copies**. They are not registered in `index.ts` and App Runner will not run them.

1. Read [docs/phase1/data-migration-examples.md](../../../docs/phase1/data-migration-examples.md).
2. Scaffold a real numbered file: `npm run data:migration:new -- your_slug`.
3. Paste the matching example and change ids / copy.

| File | Use |
|---|---|
| `add-published-course.ts` | New catalogue course |
| `add-lesson-to-course.ts` | Extra lesson on an existing course |
| `patch-portal-banner-if-empty.ts` | Portal document, only if empty |
| `add-wiki-page.ts` | Extra table + markdown file |
| `backfill-payment-settings.ts` | Settings document patch |
