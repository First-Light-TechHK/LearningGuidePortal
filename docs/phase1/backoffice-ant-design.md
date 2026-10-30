# Backoffice Ant Design migration

Local branch: `feat/backoffice-ant-design`, based on `dev` / `56fad17`.

The user requested a local branch and incremental migration on 2026-10-28. Requirements, design and task tracking are in `specs/backoffice-ant-design/`. This is a UI migration: no API, business rule, price, entitlement, database or external provider configuration change.

## Scope

| Surface | Migrated controls | Retained behavior |
|---|---|---|
| Backoffice shell | Button, Avatar, mobile Drawer | Existing menu, locale switch, sign-out, Teacher/Operator gating |
| Admin sign-in | Form, Input/Password, Alert, Button | Existing admin endpoints, cookie, first-Operator registration and verification |
| Orders | Table, mobile Card list, filter Drawer, Select, confirmation Modal, pagination | Server-filtered Orders, CSV, amounts, eligible refunds, Stripe resynchronisation, activities and errors |
| Payment | Form, Input, Switch, Tag, Alert | Existing settings PATCH; secrets stay on the server |
| Portal CMS | Inputs, Select, Buttons, image-library Modal | Bilingual copy, translation, cancellation/retry, image selection/upload and save |
| Courses | Table, mobile cards, filter Drawer, Form, pagination, tags and confirmations | Existing create, edit gates, publish/archive/restore, ownership and catalogue APIs |
| Course catalogue | Form controls, action buttons, confirmation | Existing parent identity, status and optimistic updatedAt checks |

Course outline/content authoring, media players and AI test pages keep their specialised controls. They can coexist with migrated controls under the provider; they are not claimed as fully migrated to Ant Design.

## Global CSS coexistence

1. `BackofficeProvider` is used by the Backoffice layout and the authenticated admin knowledge boundary. Root `app/layout.tsx`, Portal and My Learning do not import it.
2. Ant Design 6.6.8, Next.js registry 1.3.0 and cssinjs 2.1.2 are pinned. The registry provides first-response SSR styles and uses high hash priority so generic legacy selectors do not override controls.
3. `prefixCls="lg-ant"` separates library classes from legacy page classes. `ConfigProvider` maps en-GB/zh-CN and holds Backoffice tokens. Chinese button auto-spacing is disabled to preserve existing native-i18n copy and accessible names. The shared loading icon is decorative (`aria-hidden`) so a retiring spinner cannot prepend English “loading” to an action's accessible name; its motion respects reduced-motion preferences.
4. No `antd/reset.css`, full-site reset, CSS layer reorder, new font or replacement icon system is introduced.
5. Only legacy generic field-decoration rules skip `[class*="lg-ant-"]`. All ordinary learner and specialised editor inputs retain the original rules and selector specificity. Never add `.portal-form`, `.auth-input` or `.portal-button` decoration to migrated controls.
6. CSS Modules own shell and content layout. Theme tokens and library props own input padding, borders, focus and disabled states. The small `backoffice-ui.css` bridge is namespaced under `.backoffice-ui`; mobile button visibility has enough specificity to survive runtime style insertion.
7. Select/Modal/Drawer/confirmation hosts remain inside the provider's root, outside the scrollable shell content. Context-bound modal APIs retain locale/theme. Do not move popups into `.content` or a clipped table wrapper. Since the library's default body lock does not cover custom hosts, the provider observes visible modal dialogs, locks background scroll while any remain, compensates a scrollbar gutter and restores previous inline body values on close/unmount. The provider subscribes to prefers-reduced-motion and disables library motion for that preference, including nested popup leave transitions.

Global rules changed: two bare field rules in `app/styles.css`, CMS field decoration in `app/portal-design.css`, and native-editor field/disabled rules in `CourseManager.module.css`. Their native control values are retained. Frontend screenshots and computed heading geometry are compared separately.

## Local verification

```bash
nvm use 22
npm run typecheck
NEXT_DIST_DIR=.next-backoffice-check npm run build
node --import tsx --require ./scripts/register-tsconfig-paths.cjs --test tests/unit/backoffice-ant-design-page.test.ts
node --import tsx --require ./scripts/register-tsconfig-paths.cjs scripts/verify-backoffice-ant-design.mjs
```

The browser regression exercises both languages, desktop/mobile, Orders failure/retry and refund cancellation/retry, filters/export, Payment save failure/retry and payload, CMS library failure/retry and shared images, Course creation, teacher navigation, popup ancestry, focus and overflow. It uses mocked failures; it is not a provider acceptance test.

The production smoke starts a separate Next instance on port 3041 and temporary local data, verifies real admin login, API-backed pages, payment settings save, SSR style extraction, Teacher rejection, mobile layouts, and learner page typography/geometry. It never touches live databases, charges, mail or the developer's product store. Set BACKOFFICE_CHECK_PORT if needed. Browser binaries must be installed; macOS can use the installed Google Chrome.

Screenshots and receipts: `test-results/backoffice-ant-design/` and `test-results/backoffice-ant-design-live/` (ignored). Build warnings for existing native images, CSS `align-items:end` and inferred workspace root are recorded separately from failures.

### Local results (2026-10-28)

- TypeScript and production build passed using the separate `.next-backoffice-check` output. Next-generated changes to the tracked tsconfig/next-env files were restored after verification.
- 25 admin-host/nav/session/ownership/CMS/access tests, 13 course authoring/catalogue/editor tests and four Orders API negative tests passed (42 existing tests).
- The new browser regression passed for en-GB/zh-CN, including failure/retry, stable asynchronous button names, nested popup keyboard handling, background scroll restoration, native editor handoff and mobile navigation state.
- The final real production-instance receipt passed: SSR styles, actual admin login and API data, both locales, mobile pages/menu, Teacher Orders API 403, and learner Portal at 390/1440px. No uncaught browser/hydration errors. The four Portal heading style/geometry samples matched the recorded pre-migration baseline exactly.
- Scoped lint: zero errors; two existing native course-image warnings remain. No suppressions were added. The installed cssinjs tree resolves to one deduplicated version.
- Existing local DEV service on port 3011 remains healthy; its admin sign-in HTML contains the custom provider, registry styles and `lg-ant` prefix. No deployment or remote branch push was performed.

## Release acceptance still required

This work has not been deployed. Target smoke must cover Operator/Teacher login, forbidden routes/APIs, actual configured course data, filters/CSV, refund and Stripe reconciliation through the approved test environment, CMS translation/upload/save, published-course edit guards, native content editing and learner pages. Repeat at 390/800/1440px in both locales, including keyboard, Escape and mobile soft keyboard.

Figma node/version comparison remains pending. The migration preserves existing layout and brand intent but is not certified pixel-identical. Native mobile audio/video and live provider flows are outside this local UI evidence.
