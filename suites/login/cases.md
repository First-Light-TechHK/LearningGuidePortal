# Registration and Authentication

Black-box I/O against `/api/auth/*` and one protected purchase gate. Not a mirror of the Registration PRD.
Suite is active. Overlay select runs this product_command.

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
- Title: Active, pending, and unknown check-email share one public shape
- Steps: Register an active account and a pending account; POST check-email for both and for an unknown address
- Expected: No `exists` field; the three public JSON shapes match
- Title: check-email after a failed login still has no exists field
- Steps: Sign in with a wrong password; POST check-email for that address and an unknown address
- Expected: No `exists`; same public shape
- Title: A second pending register does not say the address already exists
- Steps: Register pending; register the same email again
- Expected: HTTP 200; copy has no "already exists"
- Title: Missing and unknown verify-email tokens share a public failure
- Steps: POST /api/auth/verify-email `{}` and `{ token: "unknown" }`
- Expected: Both HTTP 400; no `exists`; no token leak
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
- Title: Repeating password-reset still has no resetUrl or token
- Steps: POST reset twice for the same known email
- Expected: Both HTTP 200; no `resetUrl` or `token=`; same public shape
- Title: Pending and unknown password-reset share one public shape
- Steps: POST reset for a pending address and an unknown address
- Expected: Both HTTP 200; same public JSON
- Title: A failed sign-in JSON has no resetUrl or token
- Steps: POST sign-in with the wrong password
- Expected: HTTP 401; no `resetUrl` or `token=`
- Title: Confirm without a token or with a garbage token leaks nothing
- Steps: POST /api/auth/password-reset/confirm with no token, then with a random token
- Expected: Both HTTP 400; `ok: false`; no `resetUrl` or `token=`
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
- Title: PRODUCTION with mail still omits resetUrl from JSON
- Steps: APP_ENV=PRODUCTION and EMAIL_DELIVERY=discard; POST password-reset
- Expected: HTTP 200; `ok: true`; no `resetUrl` or `token=`
- Title: PPE/PROD without mail does not leak a reset URL
- Steps: APP_ENV=PPE/PROD; POST password-reset
- Expected: HTTP 503; no `resetUrl`
- Title: PRODUCTION with mail still does not issue a local social session
- Steps: PRODUCTION, LOCAL_SOCIAL_LOGIN=1, EMAIL_DELIVERY=discard; GET /api/auth/google
- Expected: HTTP 503; no session
- Title: Google and WeChat from a foreign host do not set a session
- Steps: NEXT_PUBLIC_APP_URL is https://www.example.test; GET /api/auth/google and /api/auth/wechat from another host
- Expected: HTTP 303 to the configured origin; no session cookie
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
- Title: Unauthenticated backoffice orders and payment list nothing
- Steps: GET /api/backoffice/orders and /api/backoffice/payment with no cookie
- Expected: HTTP 403; `ok: false`; no `orders` array
- Title: Signing in after the operator email is set stays a student
- Steps: Register; set BACKOFFICE_OPERATOR_EMAIL; POST sign-in
- Expected: `user.role` is student; backoffice is 403
- Title: Mixed-case operator email stays a student
- Steps: Set BACKOFFICE_OPERATOR_EMAIL to the upper-case address; register the lower-case address
- Expected: Role is student; backoffice is 403
- Title: Changing profile under the operator email does not open backoffice
- Steps: Register; set the operator email; PATCH /api/me/profile
- Expected: Role stays student; backoffice is 403
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
- Title: Second register of a pending email does not start an attacker session
- Steps: Register pending; register the same email with another password; GET /me and POST sign-in
- Expected: Second register does not set a session; attacker password is 401
- Title: Three parallel registers keep exactly one working password
- Steps: Three POST /api/auth/register for one email
- Expected: Exactly one password can sign in
- Title: Second register of an active email does not start an attacker session
- Steps: Register; clear cookies; register the same email again
- Expected: No session cookie for the attacker
- Title: Two processes registering the same email keep one working password
- Steps: Two worker processes call registerUser on the same product.json
- Expected: Exactly one register succeeds; exactly one password can sign in. Same-process POST is not this proof.
- Title: A pending register does not start a session
- Steps: EMAIL_VERIFICATION_REQUIRED=1; POST register; GET /me
- Expected: No session cookie; `user` is null
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
- Title: The kicked session cannot open a purchase quote
- Steps: Register; sign in again; POST quote with the first cookie
- Expected: HTTP 401; INV-unauth-no-grant
- Title: The kicked session cannot open checkout
- Steps: Same kick; POST checkout with the first cookie
- Expected: HTTP 401
- Title: A third sign-in invalidates the second session
- Steps: Sign in a second time, then a third time; GET /me with the second cookie
- Expected: Second cookie has no user
- Title: Unauthenticated student routes share one 401 JSON
- Steps: Without a cookie, GET/POST /api/me/profile, /api/trial, /api/subscription, /api/purchase/quote, /api/purchase/checkout, /api/purchase/demo/confirm, /api/entitlements/check, /api/my-learning, /api/study/events, /api/study/preview, /api/ai-tutor
- Expected: HTTP 401; `ok: false`; `Sign in is required.`; no user, quote, order, token, or `exists`; INV-unauth-no-grant
- Title: Logout invalidates the current session
- Steps: Register; POST /api/auth/logout; GET /me; POST quote
- Expected: HTTP 200 `ok: true`; `/me` has no user; quote is 401
- Title: Logout without a session does not leak a user
- Steps: POST /api/auth/logout with no cookie
- Expected: HTTP 200; `/me` has no user

Specified / not tested now (prose, not a function_id): AUTH-04 Google signup promotion has no live OAuth path. Local Google uses a fixed fixture email, not the operator address.
