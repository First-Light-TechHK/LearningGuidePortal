# Implementation plan

- [x] 1. Create a local branch from the current commit and inspect baseline styles and routes. Requirements 1–6.
- [x] 2. Install pinned dependencies and add Backoffice-only SSR/theme/popup/locale integration. Requirements 2, 4, 5.
- [x] 3. Migrate Orders with desktop table, mobile cards/filter drawer, export and guarded actions. Requirements 1, 3–5.
- [x] 4. Migrate Payment and Portal CMS controls while preserving save/upload/translation behavior. Requirements 1, 3–5.
- [x] 5. Migrate Course list/create/ownership/catalogue and admin sign-in; retain specialised authoring. Requirements 1, 3–5.
- [x] 6. Integrate responsive shell navigation and verify teacher/operator boundaries. Requirements 1, 3, 4.
- [x] 7. Run scoped service/API/browser regressions, frontend style comparisons, typecheck/lint/build; record remaining target/Figma gates. Requirements 2, 6.

Local evidence: 42 existing rule/service/API regressions passed; the new bilingual browser regression passed; the disposable production-instance smoke passed with no browser errors; typecheck and production build passed; scoped lint has zero errors and two retained native-image warnings. See docs/phase1/backoffice-ant-design.md. Target deployment smoke and exact Figma visual acceptance are release gates, not completed by these local checks.
