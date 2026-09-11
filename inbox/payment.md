---
id: payment
kind: prd
readiness: not-ready
source:
  repo: LibertychaserUS/LearningGuidePortal
  path: docs/phase1/source-prd/Payment_Management_PRD_v1.0_0814.docx
  ref: 6d8934e5811e371554a94aa47b2f56c40bf0cbd3
packages:
  - modules/payment-management
  - modules/subscription-management
  - modules/order-management
locale: en-GB
---

# Intent

Payment and entitlements. Cases are black-box I/O against quote, checkout, demo confirm, trial, subscription, entitlement, and webhook. The suite stays draft so Overlay does not gate on live Stripe.

# In scope

- PAY-01 Trial zero invoice.
- PAY-02 Upgrade source cancel.
- PAY-03 Double checkout.
- PAY-04 Refund revive.
- PAY-05 Webhook replay.
- PAY-06 Grace D+3.
- PAY-07 Invoice unsets cancel.
- PAY-08 Overlap delete.
- PAY-09 Device and repurchase.
- PAY-10 Demo revive.

# Out of scope

- Using payment as a merge gate.
- Hitting production ilovelearningguide.com.
- Changing LearningGuidePortal Verify.
- White-box calls into productStore.

# User cases

1. A $0 / trial path must not become a full paid term.
2. Upgrade must stop the source auto-renew; the same quote must reuse one checkout.
3. Refund and later paid events must not revive access; duplicate success events grant once.
4. Grace is original expiry + 3 days; invoice.paid must not clear cancel_at_period_end.
5. Overlapping purchase keeps the previous row; PC access does not allow mobile; a cancelled demo trial must not revive.

# Notes

`readiness: not-ready` is a hint only. Do not arm until Stripe webhook paths are claimed testable. PAY-01..07 Stripe internals stay specified; executable I/O covers the HTTP-visible subset in `tests/io/payment.test.ts`.
