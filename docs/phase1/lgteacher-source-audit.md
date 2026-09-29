# LGTeacher Source Audit

Audit date: 15 September 2026. Source: sibling `../LGTeacher`, frontend
`LearningGuide_front_teacher/src`, backend `learning-guide-teacher/src`.
This is a source inspection, not proof that the source deployment works.
The integration is under concurrent development; no full-parity claim is made.

## Findings Requiring Parent Attention

1. **Catalogue CRUD is not implemented end to end.** Frontend
   `api/category.js` calls category/subject create, update and delete routes.
   Backend `course/course.controller.ts` and `course/catalog.service.ts` only
   implement active category and subject reads. The frontend subject-list path
   `/subject/list` also differs from backend `/course/categories/:categoryId/subjects`.
   Catalogue editing is new integration work, not a working source feature to copy.
2. **500 MiB UI does not mean 500 MiB working upload.**
   `views/LessonForm.vue:165` declares 500 MiB and calls `api/upload.js`, which
   posts multipart to `/uploads`. Backend `upload/upload.controller.ts:25` caps
   multipart at 25 MiB. `upload/upload.service.ts` further defaults images to
   10 MiB and PDFs to 20 MiB. Presigned video tickets allow 1 GiB by default,
   but that separate path is not used by this frontend upload function.
3. **Source account status is not an authorisation boundary.**
   `teacher/teacher.service.ts:24` checks an MD5 password but not teacher status;
   `teacher/jwt-auth.guard.ts:29` verifies JWTs without reloading active status.
   Keep the application's session/password model and test disabled accounts,
   including sessions created before disabling them.
4. **Source preview is not the full content player.**
   `views/CoursePreview.vue:100` selects only the first sorted content group.
   Its template renders a video, PDF or raw `v-html` (`:296`), with no node-tree
   fetch, timed-node execution or embedded-instance interaction. Section and
   lesson ordering is descending in the preview, ascending in backend tree reads.
5. **Source rich text is unsafe to copy verbatim.** `ContentService` and
   `ContentNodeService` check required words/URLs, not HTML sanitisation or
   course-scoped media ownership. Raw HTML also reaches `FilePreview.vue`.
   Sanitise both persisted rich text and embedded attribute payloads; test the
   actual rendered result and cross-course references, not just a regex helper.
6. **Source deletes do not establish a historical-retention policy.** Course,
   section and lesson services call repository `remove`; content deletion
   transactionally deletes its nodes. No checks for learner purchase, progress or
   KS references occur in those service methods. The integration must preserve
   referenced identities/history or reject the delete explicitly.

## Implemented Functions Versus UI Claims

| Surface | Source implementation | Limit or stub |
| --- | --- | --- |
| Teacher authentication | Login, JWT, current teacher detail | No registration/profile-write endpoint; disabled status is unchecked |
| Teacher profile | Settings displays user-store fields | Read-only; several UI fields are absent from backend detail VO (e.g. name, phone, country); UI uses `registTime`, backend returns `createTime` |
| Course management | Owned create/list/detail/tree/update/delete; title, metadata, prices | Source prices are not authority for Learning Guide subscriptions/payments |
| Sections and lessons | Owned CRUD; sort/status; parent ownership checked on creation | No transactional aggregate save or optimistic concurrency version |
| Catalogue | Active category/subject reads sorted by sort/id | Mutation routes missing; frontend subject URL mismatch |
| Content groups | Owned text/video CRUD; ordered lesson content tree; mode/status | Text payload requires `words` even though UI offers PDF attachment |
| Pause nodes | Owned text/video/exercise/image CRUD; trigger time, sort/status | Backend enum only types 1-4; no audio/3D types 5/6; trigger time is non-negative but not checked against video duration |
| Rich-text authoring | Tiptap HTML with inline `instanceNode`; text/video/exercise/image/3D metadata | `data-instance-content`, answer type/options/results are attributes, not separate persisted node records |
| Rich-text instances | Editable labels and embedded payloads in `components/tiptap/InstanceNode.js` | Do not flatten to plain text; escaping, sanitisation and round-trip attributes need tests |
| Uploads | Multipart declaration/magic-byte checks; COS presigned tickets | Types image/video/PDF only; no completed-upload verification shown in controller |
| File preview | Image/video/audio elements; OBJ viewer; raw text HTML | Other 3D formats and quiz preview are explicit placeholders |
| Course preview | Course tree, lesson navigation, first content group, video/PDF/HTML display | Does not render all groups, timed nodes or working quizzes |
| Dashboard | Empty state in `views/Dashboard.vue` | Explicit development placeholder; no reporting data |
| AI settings | External iframe in `views/AISettings.vue` | Not an independently implemented settings service |
| Exhibit/groups/users/analytics | Routes in `router/index.js` | All render `ComingSoon.vue` |

## Regression Acceptance

The owned suite must exercise application services/routes and real HTTP/browser
flows, not replace application APIs with mock responses. Local synthetic files
and isolated local storage are used; no source credentials or live user data.

- Persist structured text and video groups, image/text/video/quiz nodes, trigger
  times, modes, activity flags and ordering; reload and inspect persisted data.
- Preserve embedded rich-text instance attributes and safe formatting while
  removing executable HTML, unsafe URLs and nested attribute payload attacks.
- Render saved content in the editor and preview/player; exercise quiz answers
  and timed nodes with actual small local media, not a fake successful response.
- Reject anonymous, student, foreign-owner and inactive writes; inactive existing
  sessions must not regain access. Reject missing/cross-origin mutation requests.
- Reject stale saves without partial writes; retain the winning version and
  unrelated history. Reject cross-course media in both group and node payloads.
- Reject deletes of referenced lessons/courses or retain the corresponding
  archived identity and learner/payment history; do not silently orphan records.
- Exercise English and Chinese pages at desktop/mobile sizes and inspect console
  errors, failed application requests, rendered assets and horizontal overflow.

## Execution Status

### Final Verified Build

Following the parent's explicit final-build readiness, the unchanged 12-check
browser runner tested default `.next` build `wb5G7iS5TTLRxnwIRNhHp` on port 3016:
**12 passed, 0 failed; exit 0**. The parent reports this build includes the mobile
layout correction, CMS guards/service fixes and current CMS frontend. The owned
runner was not changed for this final run. The latest owned unit result remains
**30/30 passed** from the preceding merged-source run; units were not rerun in
this final browser-only pass.

Both previous mobile overflow failures now pass at 390x844. The PDF page's
extracted text, interior pixel variation and dark fixture-text pixels pass on
desktop and mobile. Manual inspection confirms clear PDF text, a contained
283px-wide mobile page canvas, wrapped header navigation and a correctly framed
OBJ modal. OBJ canvas diversity, dragging and auto-rotation also pass at both
viewport sizes. The earlier blank PDF and 914px mobile overflow are resolved
for these tested fixtures and views.

Real admin login, HttpOnly admin-cookie issuance, learner-cookie read/write
rejection on the admin host, and authoring-route isolation on the learner host
all pass. The suite also passes real persisted rich text, checked task lists,
inline exercise instances, image/video/OBJ/PDF uploads and media reads, timed
video trigger/pause/answer/resume, inactive and ownership boundaries, stale
saves, XSS sanitisation, cross-course media rejection, saved preview in both
locales, and archival retaining referenced history. No uncaught browser errors,
console errors or failed same-origin requests were recorded.

- Authoritative final report: [results.json](/var/folders/cy/q9773k4j0wj6mywq15z2d8w40000gp/T/lgteacher-complete-report-BBQODw/results.json).
- PDF: [desktop canvas](/var/folders/cy/q9773k4j0wj6mywq15z2d8w40000gp/T/lgteacher-complete-report-BBQODw/pdf-desktop.png), [mobile canvas](/var/folders/cy/q9773k4j0wj6mywq15z2d8w40000gp/T/lgteacher-complete-report-BBQODw/pdf-mobile.png), [contained mobile page](/var/folders/cy/q9773k4j0wj6mywq15z2d8w40000gp/T/lgteacher-complete-report-BBQODw/pdf-page-mobile.png).
- Editor: [desktop](/var/folders/cy/q9773k4j0wj6mywq15z2d8w40000gp/T/lgteacher-complete-report-BBQODw/editor-desktop.png), [mobile](/var/folders/cy/q9773k4j0wj6mywq15z2d8w40000gp/T/lgteacher-complete-report-BBQODw/editor-mobile.png).
- OBJ: [desktop modal](/var/folders/cy/q9773k4j0wj6mywq15z2d8w40000gp/T/lgteacher-complete-report-BBQODw/obj-modal-desktop.png), [mobile modal](/var/folders/cy/q9773k4j0wj6mywq15z2d8w40000gp/T/lgteacher-complete-report-BBQODw/obj-modal-mobile.png).

The runner terminated its server, removed its isolated product store and exited
successfully. A post-run `lsof -nP -iTCP:3016 -sTCP:LISTEN` found no listener.
This is evidence for the named LGTeacher regression checks, not comprehensive
CMS, source-data migration, production-provider, deployment or Figma parity.
Final commit/push remains the parent's responsibility and is not asserted here.

### Earlier Merged Build

After explicit parent readiness for the `origin/main e9b658f` and portal-CMS
`08f84dc` merge, the runner tested default `.next` build
`cJCa31xDfRLqFfj0RZWOT` on port 3016. The owned unit/route/service suite passed
**30/30**, with no skips. The browser run completed **10 passed, 2 failed**.
Both failures are horizontal overflow: the editor and the editor's selected PDF
preview expand the document to **914px at a 390px viewport**. This is not a clean
mobile acceptance result. The overflow capture includes course metadata labels,
inputs and field containers at x=34..914, and a header sign-out button extending
past the viewport. This identifies affected elements, not a confirmed root cause.

The PDF.js replacement now passes actual page-text extraction, nonblank interior
pixels and dark fixture-text pixels on a light page at both viewport sizes.
Manual screenshot inspection confirms clear text. However, the mobile canvas
capture is 837px wide because its outer container still overflows; readability
of the captured canvas does not establish correct mobile framing.

Real `/api/auth/admin/login` succeeds for the active teacher, sets an HttpOnly
`learning_guide_admin_session` without issuing a learner cookie, and that cookie
successfully reads the owned authoring route. Learner cookies cannot read or
write admin-host authoring routes. Admin cookies do not expose those routes on
the separate learner host (`127.0.0.1`; `ADMIN_HOSTS=localhost`). Ownership,
inactive sessions, CSRF, media/ranges, persisted rich task lists and inline
instances, timed video trigger/pause/answer/resume, XSS and cross-course-media
rejection, stale saves, historical-record archival, and OBJ pixel/drag/rotation
checks passed. No uncaught errors, console errors or failed same-origin browser
requests were recorded. These checks do not cover the parent's later CMS-route
hardening, deployment or pushing MAIN; another final build/rerun may be needed.

- Latest report: [results.json](/var/folders/cy/q9773k4j0wj6mywq15z2d8w40000gp/T/lgteacher-complete-report-28rBlZ/results.json).
- Overflow detail: [element bounds](/var/folders/cy/q9773k4j0wj6mywq15z2d8w40000gp/T/lgteacher-complete-report-28rBlZ/editor-mobile-overflow.json).
- PDF text: [desktop canvas](/var/folders/cy/q9773k4j0wj6mywq15z2d8w40000gp/T/lgteacher-complete-report-28rBlZ/pdf-desktop.png), [mobile canvas](/var/folders/cy/q9773k4j0wj6mywq15z2d8w40000gp/T/lgteacher-complete-report-28rBlZ/pdf-mobile.png), [overflowing mobile page](/var/folders/cy/q9773k4j0wj6mywq15z2d8w40000gp/T/lgteacher-complete-report-28rBlZ/pdf-page-mobile.png).
- OBJ: [mobile modal](/var/folders/cy/q9773k4j0wj6mywq15z2d8w40000gp/T/lgteacher-complete-report-28rBlZ/obj-modal-mobile.png).

The first merged iteration exposed the layout failure before saving. Layout
checks now retain their own failures while allowing save and subsequent checks
to proceed. Another owned assertion was corrected to accept the required bold
phrase when following task-list text shares the same bold span. No application
files or existing tests were changed to suppress a failure.

### Earlier Baseline

The parent authorised the baseline build and tests. The owned unit/route/service
suite passed **29/29**, with no skips. The strengthened browser suite against
baseline build `_JvY_otvVbnTi4wJ7vaEn` completed **9 passed, 1 failed**.
The remaining failure is a **blank PDF preview**, despite valid persisted PDF
bytes, successful HTTP responses, and the iframe/link being present. Repeated
pixel sampling still found no visible document. This is an unresolved browser
rendering result, not proof of the root cause or of failure in every browser.

The parent subsequently identified missing `origin/main` admin-host/admin-session
and email-binding work, which is now present in the shared working tree while
the parallel integration continues. These baseline results do **not**
verify that merge, `learning_guide_admin_session`, explicit `ADMIN_HOSTS`, or the
post-build lesson-key changes. A new parent-confirmed build and rerun are required.
The owned runner and persistence fixtures have been adapted to the admin cookie,
with `ADMIN_HOSTS=localhost` and a separate `127.0.0.1` learner host. Added
assertions reject learner-cookie authoring and admin-cookie authoring on the
learner host. These adaptations were subsequently exercised in the merged run
reported above.
TypeScript checking with `npx tsc --noEmit --incremental false` passed after the
fixture adaptation. New browser reports record the build ID and both hosts.
The browser runner uses port 3016 by default, configurable `LGTEACHER_TEST_PORT`
and `NEXT_DIST_DIR` (also accepts `NEXTDIST`), an isolated temporary product
store, bounded startup/shutdown, and refuses an already occupied port.
Passing this local suite would not verify COS/S3 production configuration,
real external providers, source account migration, deployment or Figma parity.

### Owned Test Inventory

| File | Baseline coverage |
| --- | --- |
| `tests/unit/lgteacher-access.test.ts` | Teacher/owner/operator boundaries; student, missing identity and inactive status; configured operator email verification |
| `tests/unit/lgteacher-content.test.ts` | Structured groups/nodes; sanitiser attacks; course-scoped media syntax; duplicate IDs and limits; quiz validity; checked task lists and inline references; inactive-content filtering; stale draft and explicit archival |
| `tests/unit/lgteacher-media.test.ts` | Actual small image/OBJ bytes; hostile signatures/MIME/paths/material references; multipart size declaration and duplicate fields; HTTP ranges |
| `tests/unit/lgteacher-persistence.test.ts` | Real draft Route Handler and isolated file store; accounts/ownership/CSRF; sanitised persistence; competing/stale versions; foreign media; retained study/conversation and actual demo payment history; catalogue mutation/reference protection |
| `scripts/test-lgteacher-complete.ts` | Production-build HTTP and browser; legacy conversion; rich text/task list/inline quiz; real image/WebM/PDF/OBJ uploads; timed trigger/pause/resume; inactive filtering; save/reload; saved course preview in both locales; private media/ranges; XSS/stale/foreign-media failures; referenced DELETE archival; responsive screenshots and OBJ pixel/orbit/rotation assertions |

Static inspection of the owned TypeScript files reported **zero diagnostics**
after correcting the conversation fixture and the PDF fixture variable name.
Static inspection alone is not a test pass. The parent separately reports its
`course-authoring-learner-boundary.test.ts` passed, covering the public metadata
allowlist and structured lesson/exercise payload sent to the provider; that file
is outside this audit agent's ownership and has not been modified here.

The parallel implementation has since introduced `active` flags, task-list
sanitisation and an explicit local-media test policy. The baseline tests exercise
those contracts with the results above. New inline
instances use `data-node-id` references. There is no tested automatic conversion
of the source's raw `data-instance-*` attribute payloads, so source-data migration
parity is still not established.

Commands executed after parent confirmation (require a fresh confirmation for
the merged build):

```sh
node --import tsx --require ./scripts/register-tsconfig-paths.cjs --test tests/unit/lgteacher-*.test.ts
LGTEACHER_BUILD_READY=1 NEXT_DIST_DIR=.next node --import tsx --require ./scripts/register-tsconfig-paths.cjs scripts/test-lgteacher-complete.ts
```

Use the parent's actual build directory in `NEXT_DIST_DIR`. The runner sets
`APP_ENV=test`, `LOCAL_EMAIL_PREVIEW=1` and `STORAGE_BACKEND=local` for its isolated
synthetic records, as requested by the parent. It emits the
path to a persistent temporary report directory containing `results.json`,
`server.log` and screenshots. It records failures and returns non-zero; it does
not edit pre-existing tests or suppress failing application responses. PDF
coverage checks returned bytes, iframe/link integration and screenshots, not
pixel-perfect acceptance of every browser's built-in PDF viewer. A subsequent
nonblank-pixel assertion exposed the unresolved blank iframe and correctly made
the strengthened runner fail.

### Baseline Evidence

- Unit command above: 29 passed, 0 failed, 0 skipped.
- Initial browser iterations exposed test-selector issues: live Tiptap nodes
  differ from serialised HTML, nested summary elements need direct-child
  selection, wrapped select labels include option text, and the frozen player
  requires content navigation. These were corrected in the owned script, without
  modifying application code or existing tests.
- A 9/9 assertion run was superseded after manual inspection found its PDF image
  blank. The runner now waits and checks interior screenshot pixels explicitly.
- Authoritative strengthened report: [results.json](/var/folders/cy/q9773k4j0wj6mywq15z2d8w40000gp/T/lgteacher-complete-report-KnbjJ3/results.json).
- PDF failure: [desktop screenshot](/var/folders/cy/q9773k4j0wj6mywq15z2d8w40000gp/T/lgteacher-complete-report-KnbjJ3/pdf-desktop.png).
- Passing OBJ evidence: [desktop](/var/folders/cy/q9773k4j0wj6mywq15z2d8w40000gp/T/lgteacher-complete-report-KnbjJ3/obj-desktop.png), [mobile](/var/folders/cy/q9773k4j0wj6mywq15z2d8w40000gp/T/lgteacher-complete-report-KnbjJ3/obj-mobile.png). Pixel diversity/framing, drag and auto-rotation were asserted at both sizes.
- Timed-video exercise trigger, pause, answer and resume passed using the locally
  recorded WebM, not synthetic media-event dispatch or mocked application APIs.
- Each runner terminated its server and removed its temporary product store.
  A final `lsof -nP -iTCP:3016 -sTCP:LISTEN` found no listener.
