---
id: portal
kind: prd
readiness: ready
source:
  repo: LibertychaserUS/LearningGuidePortal
  path: docs/phase1/source-prd/Portal_PRD_v1.0_0814.docx
  ref: 6d8934e5811e371554a94aa47b2f56c40bf0cbd3
packages:
  - modules/portal
  - modules/course-management
locale: en-GB
---

# Intent

Published course pages for tourists: store identity, syllabus lock or preview, and CTA bands. Not a full Portal PRD dump.

# In scope

- UC-PORTAL-1 Course page primitives come from the product store.

# Out of scope

- Payment checkout (see `inbox/payment.md`).
- My Learning overview cards (see `inbox/my-learning.md`).
- Hitting production hosts.

# User cases

1. A tourist opens a published course and sees previewable versus locked lessons from the store.

# Notes

Excerpt only. Suite stays `draft` until a human arms it. Id is copied from `UC-PORTAL-course-page-primitives.test.ts`.
