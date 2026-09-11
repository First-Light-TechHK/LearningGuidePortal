---
id: my-learning
kind: prd
readiness: ready
source:
  repo: LibertychaserUS/LearningGuidePortal
  path: docs/phase1/source-prd/My_Learning_PRD_v1.0_0814.docx
  ref: 6d8934e5811e371554a94aa47b2f56c40bf0cbd3
packages:
  - modules/my-learning
  - app/[locale]/account
locale: en-GB
---

# Intent

Signed-in My Learning overview: entitled or preview-started course cards and unique Learning Point progress.

# In scope

- ML-FR-004 Course cards on the My Learning overview.
- ML-FR-007 Unique Learning Point progress 0–100.

# Out of scope

- Payment (see `inbox/payment.md`).
- Login page itself (see `inbox/login.md`). Session gate is AUTH-06.

# User cases

1. A signed-in user opens My Learning and sees their own progress, not someone else's.

# Notes

Excerpt only. Do not vendor the docx. Suite stays `draft` until a human arms it. Ids come from existing unit tests, not a second numbering system.
