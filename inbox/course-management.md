---
id: course-management
kind: prd
readiness: ready
source:
  repo: LibertychaserUS/LearningGuidePortal
  path: docs/phase1/lgteacher-integration.md
  ref: 6d8934e5811e371554a94aa47b2f56c40bf0cbd3
packages:
  - modules/course-management
locale: en-GB
---

# Intent

Course content upload and draft/publish commit. Cases are black-box I/O against backoffice media, draft save, publish, and learner media GET. The suite is active. Spec I/O is the authority; product red means fix the product.

# In scope

- CM-01 Size and emptiness before persist.
- CM-02 Extension, MIME, signature and self-contained container.
- CM-03 Raster decode before persist and before draft/publish.
- CM-04 Admin host, ownership and same-origin.
- CM-05 Course-owned typed references before draft/publish commit.
- CM-06 New writes reject off-origin and COS URLs.
- CM-07 Learner GET: published public-lesson refs without login; no XSS persist.

# Out of scope

- Changing LearningGuidePortal Verify or adding `test:io` to `test:ci`.
- Forge `apply`, new Rulesets, or `deny_paths`.
- Portal CMS library (`PORTAL_MEDIA_*`, sharp on `/api/portal-media`).
- Transcoding, malware scan, or a 500 MiB upload ticket.
- Hitting production hosts.
- White-box calls that skip the Route Handler.

# User cases

1. A teacher uploads a real image under 25 MiB and the server stores one private asset (CM-01, CM-02, CM-04).
2. Empty, oversized, spoofed, or undecodable rasters never write `.bin` (CM-01, CM-02, CM-03).
3. Draft save and publish fail closed if a reference is missing, cross-course, type-mismatched, or an external/COS URL (CM-05, CM-06). INV-media-before-commit and INV-no-external-write.
4. Learners only GET referenced published media; public first-lesson refs work without a cookie; expired or inactive refs 404 (CM-07). INV-media-authz.

# Notes

Suite is active. Executable I/O lives in `tests/io/course-management.test.ts`. Course Management sits under Portal PRD plus `docs/phase1/lgteacher-integration.md`. Portal CMS already full-decodes images; course media must meet that decode bar on write and again on commit. Video/audio stay container-checked (no ffmpeg) — that limit is specified, not hidden. Do not rewrite CM-03 / CM-06 / CM-07 to accept signature-only rasters, HTTPS covers, or COS writes.
