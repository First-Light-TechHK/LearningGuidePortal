---
id: visitor-trial
kind: prd
readiness: not-ready
source:
  repo: LibertychaserUS/LearningGuidePortal
  path: docs/phase1/source-prd/Visitor_Trial_PRD_v1.0_0814.docx
  ref: 6d8934e5811e371554a94aa47b2f56c40bf0cbd3
packages:
  - modules/subscription-management
  - modules/payment-management
  - modules/portal
locale: en-GB
---

# Intent

Visitor / Trial. Cases are black-box I/O against trial quote, `/api/trial`, demo confirm, entitlement check, and study/events. The suite is active: Overlay CI runs TRIAL-01/02 HTTP I/O. Spec I/O is the authority; product red means fix the product.

# In scope

- TRIAL-01 Trial quote + `/api/trial` + demo complete/cancel.
- TRIAL-02 Cancelled trial stays false; second complete does not grant.
- Trial Canceled → Trial Active before original `trial_end` without extending `validTo`.

# Out of scope

- Using visitor-trial as a merge gate.
- Hitting production ilovelearningguide.com.
- Changing LearningGuidePortal Verify.
- White-box calls into productStore.

# User cases

1. A completed demo trial grants visitor access inside three days.
2. Cancelled checkout or cancelled trial leaves entitlement false and blocks locked study/events.
3. A second complete after cancel does not revive (TRIAL-02).
4. Resume inside the original window restores access and does not extend `validTo`.

# Notes

`readiness: not-ready` is a hint only. Executable I/O lives in `tests/io/visitor-trial.test.ts`. TRIAL-01 / TRIAL-02 are unique; they cover the visitor face of PAY-01 / PAY-10. Do not rewrite PAY-10 / TRIAL-02 to accept a second complete or a trial after a paid purchase.
