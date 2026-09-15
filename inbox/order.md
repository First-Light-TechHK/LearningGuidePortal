---
id: order
kind: prd
readiness: not-ready
source:
  repo: LibertychaserUS/LearningGuidePortal
  path: docs/phase1/source-prd/Order_Management_PRD_v1.0_0814.docx
  ref: 6d8934e5811e371554a94aa47b2f56c40bf0cbd3
packages:
  - modules/order-management
  - modules/payment-management
locale: en-GB
---

# Intent

Backoffice Order Management. Cases are black-box I/O against `/api/backoffice/orders`. The suite is active: Overlay CI runs ORDER-01 HTTP I/O. ORDER-02 stays specified in cases.

# In scope

- ORDER-01 Student and unauthenticated callers cannot list or refund orders.
- ORDER-02 Operator refund + later `invoice.paid` must not revive (specified; no operator seed). Related to PAY-04; id is unique.

# Out of scope

- Using order as a merge gate.
- Hitting production ilovelearningguide.com.
- Changing LearningGuidePortal Verify.
- White-box calls into productStore.
- Inventing an operator register path.

# User cases

1. A student session cannot GET or refund backoffice orders (403).
2. An unauthenticated GET is 403.
3. After an operator refund, a later paid invoice must not restore entitlement.

# Notes

`readiness: not-ready` is a hint only. Executable I/O lives in `tests/io/order.test.ts`. Operator refund + `invoice.paid` stays specified.
