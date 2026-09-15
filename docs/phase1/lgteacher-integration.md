# LGTeacher Integration into the Existing Backoffice

Source: First-Light-TechHK/LGTeacher, commit `30d8e457621e000605b2941fbd9430f155b73e04`, audited 15 September 2026. See [source audit](lgteacher-source-audit.md) for evidence and source defects.

## Architecture

This is a native integration into the existing `/{locale}/backoffice/courses` route, CourseManager and CourseOutlineEditor. It is not a second backoffice, Vue application, NestJS service, database or authentication system. Portal editing, order management and payment operations remain in their existing routes. Profile and course summary are sections of the same course-management page.

The merge includes `main` at `e9b658f` and `feat/portal-cms` at `08f84dc`: bilingual portal editing, one-shot translation and the portal image library remain in the existing backoffice. Admin has a separate sign-in and `learning_guide_admin_session` cookie on configured admin hosts. Learner sessions cannot author courses, preview private media as an author, edit the portal or manage payments. Authorised teachers use the admin login for assigned courses; operators retain portal, finance and global KS access.

The existing Next.js application serves editor, APIs, learner pages and tutor. The product aggregate remains in the existing PostgreSQL repository in AWS, or the isolated local development store. Private authored media uses the existing VFS/S3 storage configuration. No Tencent COS credentials, teacher MD5 passwords or separate JWTs are imported.

## Function Mapping

| Source capability | Integrated destination and behaviour |
| --- | --- |
| Teacher login and profile | Existing separate admin login/session and verified account; active teacher role and course assignment; read-only profile |
| Owned course list | Existing CourseManager with search, category/subject/level/status filters, pagination and actual course counts |
| Course metadata | Title, subtitle, description, cover upload/removal, level, tags, academic category/subject, reference price and discount |
| Course lifecycle | Create, edit, publish/unpublish; versioned drafts; archival and restore instead of destruction of purchased/studied identities |
| Category and subject catalogue | Operator-controlled creation, editing and archival; referenced items protected. Completes mutation paths absent from the source backend |
| Sections and lessons | Create, rename, reorder, move and explicitly remove; identifiers and archived content retained; duration and public first lesson retained |
| Content groups | Ordered rich text, video and PDF groups; lecture/interactive mode; active status |
| Rich-text formatting | Tiptap headings, inline formatting, lists/tasks, links, tables and editing operations, aligned/resizable/captioned images and inline instance references |
| Interactive nodes | Text, image, video, audio, exercise and self-contained 3D instances; ordering, active status and video trigger times |
| Exercises | Short-answer reveal and single/multiple-choice questions with feedback |
| Media | Private course-scoped image, PDF, video, audio, OBJ and GLB upload and preview; GET/HEAD and byte-range playback |
| Preview and learner delivery | All groups and interactive player in existing backoffice preview, protected learning room and public lesson; entitlement and progress retained |
| AI settings | Operator link to existing KS workbench, not an imported external Amplify iframe |
| Tutor grounding | Sanitised active lesson text and exercises alongside existing course knowledge and conversation; no invented media transcription |

The source dashboard is an empty state; this integration shows real scoped course counts. Source exhibit, study-group, user and analytics menu entries are ComingSoon screens, not working functions. Source audio/3D node persistence and catalogue mutations were incomplete; the integration supplies native equivalents rather than reproducing broken routes.

## Contracts and Security

- Mutations reload the authenticated actor from the existing store. Teachers manage owned/assigned courses; operators retain administration. A student ID in an assignment does not grant author access. Only operators may assign a verified active account and confer the teacher role. Orders and payments remain operator-only.
- `PUT /api/backoffice/courses/:courseId/draft` uses the existing transaction and `expectedUpdatedAt`. Stale writers receive 409. Missing existing IDs require an explicit removal list. Removed content is archived, not deleted from learning/conversation/payment history.
- `contracts/lesson-content.ts` defines groups and nodes. `validateLessonContents` preserves authoring state and sanitises HTML; `sanitiseLessonContents` additionally withholds inactive material on learner reads. Structured content is authoritative when present. Legacy text lessons still work; old clients cannot silently flatten rich content.
- `POST /api/backoffice/courses/:courseId/media` accepts multipart `file` and optional `usage`. Same-origin and course-management access are required. Size, extension, MIME, signature and self-contained model structure are checked. Saved references must belong to the course and match the content type.
- `GET/HEAD /api/course-media/:courseId/:assetId` rechecks access. Authors preview their course assets; published covers and public-lesson references may be public; other attached published media requires entitlement. Unattached, draft and inactive-only media is not exposed to learners. Responses are private/no-store, cookie-varying, nosniff and same-origin. Authored covers bypass the public image optimiser.
- Academic catalogue metadata does not redefine the three commercial subscription scopes. Reference prices and discounts are metadata only. Stripe prices, Checkout, orders, subscriptions and entitlements remain server-authoritative.
- Public catalogue JSON has an explicit metadata allowlist, excluding author assignments, archived content and private lesson data.

## Operational Boundaries

The multipart limit is 25 MiB/file, matching the source frontend's actual backend path rather than its misleading 500 MiB label. No large-file upload-ticket workflow, transcoding or malware-scanning service is added. OBJ/GLB must be self-contained; external resources are rejected. VFS range responses read the bounded whole object first, so browser seeking does not reduce S3 read size.

Optional fields extend the existing aggregate; no new table or source-data migration is required. This code change does not migrate source accounts, live courses or COS objects. Release through existing CI/CD; a Git push does not establish an AWS deployment. See [release runbook](release-runbook.md).

## Verification

The [source audit](lgteacher-source-audit.md) records tests and the isolated production-build browser report. Unit/Route Handler tests cover sanitisation, round trips, ownership, inactive users, stale writes, archives, catalogue constraints, media ranges, and tutor/public-data boundaries. Authentication/payment suites use isolated fixtures, not real provider accounts or payments. Browser tests use actual application HTTP routes and persisted local data, including playable video and 3D fixtures, without mocking successful application responses.

Combined verification on 15 September 2026: 163 unit tests, 93 authentication tests and 11 payment tests passed. Production build and type checking passed; lint had no errors. The final authoring browser run passed all 12 checks against build `wb5G7iS5TTLRxnwIRNhHp`, including separate admin login, cookie/host rejection, desktop/mobile PDF rendering and 3D interaction. The catalogue browser run also passed. CMS hardening adds bounded same-origin operator APIs, complete translation-response validation, decoded image validation and immutable per-asset metadata; no extra deployed service is required.

CMS browser checks also passed: `scripts/test-portal-cms-built.ts` exercises actual upload, bilingual save/reload, shared images and responsive layouts against the production build; `scripts/test-portal-cms-ui.mjs` uses explicitly synthetic deferred responses to exercise stale-response races, disabled controls, visible errors, retry and dialog focus. These race tests do not establish live translation-provider acceptance.

Local tests do not establish live AWS storage acceptance, external-provider acceptance, source-data migration or Figma pixel parity.

The broader `test:io` specification suite is not green: an isolated archive of unmodified upstream `a905035` produced 56 passes and 21 failures out of 77 tests. The combined branch also produced 56 passes and 21 failures. These include pre-existing authentication/session and payment-contract discrepancies. The exact failing set differs at the production-configuration boundary: this branch rejects a missing HTTPS public origin earlier and correctly disables local social login for `APP_ENV=PRODUCTION`, whereas upstream's test expectations differ. The stricter managed-environment checks have been retained. Do not treat the passing authoring/authentication/payment regression suites as clearance of the wider specification suite.

Dependency audit on 15 September 2026 reports eight pre-existing affected dependency entries (one critical, seven high) across Next.js, Nodemailer and transitive packages. Their locked versions are unchanged from the parent commit. The added Tiptap, Three.js, PDF.js and sanitisation packages are not the reported packages. This functional merge does not remediate those existing dependency risks or constitute production security clearance; review and patch them before production promotion.
