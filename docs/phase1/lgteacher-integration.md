# LGTeacher integration

Source reviewed: `First-Light-TechHK/LGTeacher`, commit `30d8e457621e000605b2941fbd9430f155b73e04` (15 September 2026).

## Architecture decision

Port business functions into the existing Learning Guide Backoffice Portal. Retain the Next.js deployment, application sessions, operator authorisation, PostgreSQL product repository, S3 and existing payment services. Do not deploy the source NestJS/MySQL/COS stack or duplicate its JWT login. A Git history merge alone cannot integrate these unrelated frameworks and data models.

## Source inventory and delivery status

| Function in LGTeacher | Learning Guide destination | Status |
| --- | --- | --- |
| Course creation and publish/unpublish | Existing Course Management | Existing |
| Course title/description editing | Course outline editor | Implemented in this change |
| Section creation, renaming and ordering | Course outline editor | Implemented in this change |
| Lesson creation/editing/ordering/moving | Course outline editor | Implemented for current text lesson model |
| Course category/subject catalogue | Existing three commercial categories | Source subject catalogue not yet ported; do not change subscription scopes implicitly |
| Course/lesson deletion | Archival workflow | Not ported; existing lesson IDs deliberately retained for progress/KS references |
| Rich text and text/video content groups | Versioned lesson content editor | Not yet ported |
| Content nodes: text/video/exercise/image, trigger times | Lesson content tree and learner renderer | Not yet ported |
| Audio, PDF, image, video and OBJ preview/upload | Private S3-backed media workflow | Not yet ported; no COS credentials imported |
| Teacher ownership | Course Manager/Operator authorisation | Existing operators only; separate teacher ownership not yet implemented |
| Teacher account settings | Existing account system | Source profile not imported |
| AI Settings | Existing KS configuration | Source is an external Amplify iframe, not an independent settings implementation; not copied |
| Exhibits, study groups, users, analytics | Existing business-function boundaries | Source routes are ComingSoon placeholders; not counted as implemented functionality |

## Draft API

`PUT /api/backoffice/courses/:courseId/draft` accepts `CourseDraftInput` from `contracts/course-authoring.ts`. Requires an active operator session and same-origin request. Updates title, description and ordered sections/lessons in one existing product-store transaction. Includes `expectedUpdatedAt`; stale saves return 409. Existing course/lesson identities and all unrelated purchase/subscription data are preserved. Published courses must first be unpublished. New client IDs use `new-...` and are replaced with server UUIDs. Existing lessons cannot be silently deleted. Only one public lesson is permitted.

Response: `{ok:true,data:course,requestId}` or `{ok:false,code,requestId}`. Codes: `restricted`, `invalid`, `conflict`, `published`, `notFound`, `failed`. UI messages are bilingual.

The aggregate schema remains backwards compatible; this change adds no database table and does not migrate source teacher data. It does not introduce a second deployment or authorise a production release. The complete LGTeacher merge remains unfinished until the pending rows above, media access controls, content sanitisation, learner delivery and design acceptance are implemented and tested.

## Verification for this increment

- Production build passed (existing lint warnings remain).
- Four targeted tests passed: pure draft rules plus real Route Handler/store authorisation, persistence, stale-write and cross-origin checks.
- `scripts/test-backoffice-authoring.ts` passed against an isolated production-build server with temporary local records: operator login cookie, section/lesson creation, public lesson selection, save/reload and 1440/390-pixel screenshots.
- No source teacher accounts or live course data were migrated. No deployment or full Figma parity is claimed.
