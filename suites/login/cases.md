# Registration and Authentication

Black-box I/O against `/api/auth/*` and one protected purchase gate. Not a mirror of the Registration PRD.
Suite stays draft so Overlay does not run these cases and does not go red.

Shallow to deep: public JSON shape → production leak → role → password takeover → session kick.

## AUTH-01 Email enumeration

### Functional
- Title: check-email does not distinguish a known address
- Steps: Register; POST /api/auth/check-email for that address and for an unknown address
- Expected: Same HTTP status; no `exists` field; same public JSON shape

### Negative
- Title: Register copy and pending login do not leak
- Steps: Register the same email twice; sign in a pending address and a missing address
- Expected: Second register does not say "already exists"; pending login is not 403-only; same public shape as a missing address

### Edge
- Title: Resend does not 429 only for a pending address
- Steps: POST /api/auth/resend-verification for a pending address, a missing address, and the pending address again
- Expected: Same status and public shape; never 429 only for pending

## AUTH-02 Password-reset leak

### Functional
- Title: Reset request JSON has no resetUrl or token
- Steps: Register; POST /api/auth/password-reset/request
- Expected: HTTP 200; `ok: true`; no `resetUrl`, no `token`, no `token=`

### Negative
- Title: Reset does not reveal whether the email exists
- Steps: POST reset for a known email and an unknown email
- Expected: Both HTTP 200; same public JSON shape

### Edge
- Title: Sign-in without credentials
- Steps: POST /api/auth/sign-in `{}`
- Expected: HTTP 401; `AUTHENTICATION_FAILED`; no session

## AUTH-03 PRODUCTION is production

### Functional
- Title: APP_ENV=PRODUCTION does not leak a reset URL
- Steps: Set APP_ENV=PRODUCTION; POST password-reset without mail
- Expected: HTTP 503; no resetUrl or token

### Negative
- Title: PRODUCTION does not issue a local social session
- Steps: APP_ENV=PRODUCTION and LOCAL_SOCIAL_LOGIN=1; GET /api/auth/google
- Expected: HTTP 503; no session cookie; /api/auth/me has no user

### Edge
- Title: DEV reset still does not leak a token
- Steps: APP_ENV=DEV; POST password-reset for an unknown email
- Expected: HTTP 200; no resetUrl

## AUTH-04 Operator email

### Functional
- Title: Registering the operator email stays a student
- Steps: Set BACKOFFICE_OPERATOR_EMAIL; POST register; GET /api/auth/me and GET /api/backoffice/courses
- Expected: `user.role` is student; backoffice is 403

### Negative
- Title: Matching the operator email later does not open backoffice
- Steps: Register a student; set BACKOFFICE_OPERATOR_EMAIL to that address; GET backoffice
- Expected: HTTP 403; role stays student

### Edge
- Title: Unauthenticated backoffice
- Steps: GET /api/backoffice/courses with no cookie
- Expected: HTTP 403

## AUTH-05 Pending overwrite

### Functional
- Title: Second register does not take over the first password
- Steps: Register; register the same email with another password; sign in both passwords
- Expected: First password signs in; second password is 401

### Negative
- Title: Verification required without mail is 503
- Steps: EMAIL_VERIFICATION_REQUIRED=1; POST register
- Expected: HTTP 503; `EMAIL_DELIVERY_NOT_CONFIGURED`

### Edge
- Title: Concurrent same-email register
- Steps: Two parallel POST /api/auth/register for one email
- Expected: Exactly one password can sign in

## AUTH-06 Session kick

### Functional
- Title: A second sign-in invalidates the first session
- Steps: Register; POST sign-in again; GET /api/auth/me with each cookie
- Expected: First cookie has no user; second cookie returns that email; INV-unauth-no-grant for the kicked session

### Negative
- Title: Changing password invalidates the previous session
- Steps: Register; PATCH /api/me/profile with a new password; GET /me and POST quote
- Expected: `user` is null; quote is 401

### Edge
- Title: Forged session cookie
- Steps: Set `learning_guide_session` to a random token; GET /me and POST quote
- Expected: `user` is null; quote is 401
