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

Application and browser runs are **not authorised yet**: the parent must confirm
the integration build is ready. Do not infer readiness from a BUILD_ID alone.
This document will record actual commands/results after that confirmation.
The browser runner uses port 3016 by default, configurable `LGTEACHER_TEST_PORT`
and `NEXT_DIST_DIR` (also accepts `NEXTDIST`), an isolated temporary product
store, bounded startup/shutdown, and refuses an already occupied port.
Passing this local suite would not verify COS/S3 production configuration,
real external providers, source account migration, deployment or Figma parity.

### Owned Test Inventory

| File | Assertions prepared; execution pending |
| --- | --- |
| `tests/unit/lgteacher-access.test.ts` | Teacher/owner/operator boundaries; student, missing identity and inactive status; configured operator email verification |
| `tests/unit/lgteacher-content.test.ts` | Structured groups/nodes; sanitiser attacks; course-scoped media syntax; duplicate IDs and limits; quiz validity; checked task lists and inline references; inactive-content filtering; stale draft and explicit archival |
| `tests/unit/lgteacher-media.test.ts` | Actual small image/OBJ bytes; hostile signatures/MIME/paths/material references; multipart size declaration and duplicate fields; HTTP ranges |
| `tests/unit/lgteacher-persistence.test.ts` | Real draft Route Handler and isolated file store; accounts/ownership/CSRF; sanitised persistence; competing/stale versions; foreign media; retained study/conversation and actual demo payment history; catalogue mutation/reference protection |
| `scripts/test-lgteacher-complete.ts` | Production-build HTTP and browser; legacy conversion; rich text/task list/inline quiz; real image/WebM/PDF/OBJ uploads; timed trigger/pause/resume; inactive filtering; save/reload; saved course preview in both locales; private media/ranges; XSS/stale/foreign-media failures; referenced DELETE archival; responsive screenshots and OBJ pixel/orbit/rotation assertions |

Static inspection of the owned TypeScript files reported **zero diagnostics**
after correcting the conversation fixture and the PDF fixture variable name.
This is not a test pass. The parent separately reports its
`course-authoring-learner-boundary.test.ts` passed, covering the public metadata
allowlist and structured lesson/exercise payload sent to the provider; that file
is outside this audit agent's ownership and has not been modified here.

The parallel implementation has since introduced `active` flags, task-list
sanitisation and an explicit DEV local-media policy. The tests target those
contracts; runtime correctness remains unverified until execution. New inline
instances use `data-node-id` references. There is no tested automatic conversion
of the source's raw `data-instance-*` attribute payloads, so source-data migration
parity is still not established.

After parent confirmation only:

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
pixel-perfect acceptance of every browser's built-in PDF viewer.
