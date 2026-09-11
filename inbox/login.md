---
id: login
kind: prd
readiness: not-ready
source:
  repo: LibertychaserUS/LearningGuidePortal
  path: docs/phase1/source-prd/Registration_Authentication_PRD_v1.0_0814.docx
  ref: 6d8934e5811e371554a94aa47b2f56c40bf0cbd3
packages:
  - modules/user-registration
  - app/api/auth
locale: en-GB
---

# Intent

Registration and session. Cases are black-box I/O against `/api/auth/*`. The suite stays draft so Overlay does not gate until a human arms it.

# In scope

- AUTH-01 Email enumeration.
- AUTH-02 Password-reset leak.
- AUTH-03 PRODUCTION is production.
- AUTH-04 Operator email.
- AUTH-05 Pending overwrite.
- AUTH-06 Session kick.

# Out of scope

- Using login as a merge gate.
- Changing LearningGuidePortal Verify.
- Real WeChat QR or production OAuth.
- White-box calls into productStore.

# User cases

1. Check-email, register, login and resend do not reveal whether an address is pending or known.
2. Password-reset JSON never includes resetUrl or a raw token.
3. APP_ENV=PRODUCTION does not leak reset URLs or local social sessions.
4. Registering BACKOFFICE_OPERATOR_EMAIL stays a student.
5. A second register for the same email does not take over the first password.
6. A second sign-in or a password change invalidates the previous session.

# Notes

`readiness: not-ready` is a hint only. Do not arm until live login is claimed testable. Executable I/O lives in `tests/io/login.test.ts`.
