# Stripe sandbox configuration and verification

## Scope

This configuration uses Stripe test keys. Local development uses local storage; the AWS DEV site uses its existing PostgreSQL and S3 storage. No live Stripe price, live subscription or account-wide Managed Payments setting was changed.

Set these in the ignored `.env.local`:

```dotenv
APP_ENV=DEV
STORAGE_BACKEND=local
PAYMENT_MODE=stripe
STRIPE_SANDBOX=1
NEXT_PUBLIC_APP_URL=http://127.0.0.1:3014
```

Provide the test secret and local Stripe CLI signing secret separately. Never commit either. A Dashboard endpoint secret and a CLI forwarding secret are not interchangeable. The supplied signing secret did not match the local CLI; `.env.local` now contains the verified CLI secret.

## Authoritative test catalogue

| Product | Six months, USD | Twelve months, USD | Lookup key prefix |
| --- | ---: | ---: | --- |
| Everything | 99 | 198 | `lg_everything` |
| European Humanities | 39 | 78 | `lg_europeanhumanities` |
| Chinese Humanities | 39 | 78 | `lg_chinesehumanities` |
| Science | 39 | 78 | `lg_science` |

Lookup keys end in `_6m` or `_12m`. The Science `_12m` lookup key was moved from an incorrectly monthly test price to a new annual test price; the incorrect price was archived. Existing subscriptions were not migrated.

`services/stripePrices.ts` maps each LG plan to its configured lookup key or Price ID. `resolveStripePrice()` verifies the billing period, active status, fixed amount, currency and sandbox flag. Checkout uses the existing Stripe Price ID rather than creating an inline recurring price.

Synchronise all eight plans before starting the local application:

```sh
node --env-file=.env.local --import tsx --require ./scripts/register-tsconfig-paths.cjs scripts/sync-stripe-sandbox.ts
```

The command validates all prices before writing. It upserts the matching local plans and expires old quotes for changed prices. Existing orders, subscriptions and payments retain their history. Unmapped single-course/mobile plans are not offered by the sandbox catalogue; they were not deleted.

## AWS sandbox

The existing Singapore App Runner service uses `PAYMENT_MODE=stripe` and `STRIPE_SANDBOX=1`. Its public origin remains `https://www.ilovelearningguide.com`. Google, WeChat, email verification and storage configuration are preserved.

The test API key and the AWS endpoint's signing secret are stored separately in AWS Secrets Manager. The App Runner instance role has read permission for these two secrets. Never use the local CLI signing secret on AWS.

The dedicated test webhook is `https://www.ilovelearningguide.com/api/payment/webhook`. It receives Checkout completion, asynchronous success/failure, expiry, invoice-paid and invoice-payment-failed events. Stripe's account-wide settings are unchanged.

For an authorised operator with the AWS DEV database environment loaded, catalogue synchronisation is:

```sh
CONFIRM_SANDBOX_CATALOGUE=learning-guide/dev node --import tsx --require ./scripts/register-tsconfig-paths.cjs scripts/sync-stripe-sandbox.ts --cloud
```

The command requires `APP_ENV=DEV`, the exact DEV data prefix, `STRIPE_SANDBOX=1` and a test API key. It validates all eight Stripe prices first, then updates only matching plans and affected outstanding quotes within a PostgreSQL transaction. It does not import local users or replace the cloud dataset. Run during a quiet maintenance period: the existing application's whole-document storage is not a substitute for a fully transactional order database across multiple instances.

App Runner automatic deployment is disabled, matching the repository's manual-release workflow. Pushes run verification; release is an explicit operation after verification. A configuration update alone does not necessarily fetch the latest Git commit, so deploy the application source explicitly and verify the resulting site.

## Run locally

The port override below preserves any existing `.env.local` origin for another developer instance:

```sh
NEXT_DIST_DIR=.next-stripe-sandbox NEXT_PUBLIC_APP_URL=http://127.0.0.1:3014 npm run dev -- --port 3014
```

In a second terminal:

```sh
NEXT_PUBLIC_APP_URL=http://127.0.0.1:3014 node --env-file=.env.local scripts/listen-stripe-sandbox.mjs
```

Keep both processes running. The listener forwards actual Stripe sandbox events to `/api/payment/webhook` and hides its signing secret in terminal output. No public webhook endpoint was created for localhost.

For an isolated production-build check, stop only this sandbox server, run `NEXT_DIST_DIR=.next-stripe-sandbox npm run build`, then replace `dev` with `start` in the command above. This tests the compiled application; it does not enable live payments.

## Sandbox Checkout behaviour

- Requires a test API key and rejects live prices and live webhook events.
- Uses standard Checkout in USD for these test sessions. The sandbox account defaults to Managed Payments, which mandates adaptive pricing. Only the sandbox session request disables Managed Payments and adaptive pricing; the account setting is unchanged. Before any live launch, the business must decide its merchant-of-record, currency and tax policy. See [Stripe Managed Payments](https://docs.stripe.com/payments/managed-payments/update-checkout).
- Checks all three LG purchase consents and server-generated quotes before Checkout.
- Uses the LG order ID as the normal-purchase Checkout idempotency key.
- Does not grant access for `payment_status=unpaid`. Grants access after a valid signed paid event and checks the order amount/currency.
- Handles `checkout.session.expired` and `checkout.session.async_payment_failed` without granting access or revoking an already successful purchase.
- A browser return/cancel is not itself proof of payment or session expiry. Closing Checkout can leave it open for retry; LG records cancellation after the session expires. A declined card can likewise be retried while the session remains open.
- Invoice events are marked processed after successful handling, not before. Invoice-ID checks and repeat-safe grace handling support retries. Current Stripe invoice-parent and subscription-item period fields are supported.

## Results, 9 September 2026

| Test | Evidence | Result |
| --- | --- | --- |
| Eight lookup keys | Actual Stripe API reads; all test prices active; correct amounts and billing periods | Passed |
| Hosted payment | LG quote and order -> actual standard Stripe sandbox Checkout -> test card -> LG return | Passed |
| Successful payment update | Stripe session complete/paid, USD 99; signed Checkout and invoice events received with HTTP 200; LG order paid | Passed |
| Course access | Same learner received one active Everything entitlement and a six-month subscription; period ends 9 March 2027 | Passed |
| Abandoned session | A separate USD 39 test session was explicitly expired through Stripe; actual signed expiry event returned HTTP 200 | Passed |
| No unpaid access | Expired order became cancelled; its learner had no entitlements | Passed |
| Focused automated suite | Seven tests covering price errors, unpaid completion, duplicate success, expiry, async failure, late failure, signatures, live events, amount mismatch and invoice retry | Passed; provider event fixtures, not real card failures |
| Regression suite | TypeScript, 12 unit tests and 91 integration tests | Passed |
| Build | Isolated Next.js production build using sandbox configuration | Passed with existing lint warnings |

The successful sandbox subscription remains available for inspection. No real money was charged. Full declined-card, 3-D Secure, renewal, refund, upgrade and trial-lifecycle acceptance is not established by these results.

## AWS verification, 9 September 2026

Application commit: `7c733fc`. App Runner configuration operation `7974f52ee30f43ba8ff989628fac11d5` and source deployment `bd582dc273e941329e739086ef79e60b` both succeeded. The source deployment was necessary: the configuration-only update retained the previous application build. A preliminary attempt on that older build was rejected by Stripe's Managed Payments validation and did not take payment or grant access.

Tests below used the public AWS site, actual Stripe test Checkout, the dedicated HTTPS webhook and the AWS database. Two isolated test accounts were prepared with the application's registration and email-verification functions; these payment tests do not constitute a new acceptance test of email delivery or social login.

| Check | Observed result |
| --- | --- |
| USD 99 Everything purchase | Hosted Checkout accepted the Stripe test card and returned to LG's purchase-complete page. `livemode=false`; payment status `paid`. |
| Persisted order | `order_1788953288226_db989b47` is `paid`, USD 99, with the Stripe subscription and invoice references. |
| Signed webhook processing | `checkout.session.completed` event `evt_1UDjfpLrOEkdi8OVl9CwIngD` and `invoice.paid` event `evt_1UDjfoLrOEkdi8OVXERUvKL3` have persisted processing receipts. |
| Course access | Exactly one active Everything entitlement and one active six-month subscription for the purchasing test account, ending 9 March 2027. |
| Expired USD 39 Checkout | Separate learner and actual Stripe session, explicitly expired through the test API. `order_1788953436143_61f218d8` is `canceled`; no entitlement or subscription exists for that learner. |
| Expiry webhook | `evt_1UDji6LrOEkdi8OVHgpxpp9e` was processed and stored as `checkout.session.expired`. |
| UI regression | All 198 selected Figma property checks passed on the AWS sign-in page across Chromium, Firefox and WebKit. This is not full-site pixel-equivalence certification. |
| Existing configuration | PostgreSQL/S3, Google, WeChat and email remain configured; email verification remains required. No authentication setting was relaxed. |

The site remains DEV with Stripe sandbox payments. These checks establish successful purchase and expired-session behaviour, not full production payment-lifecycle acceptance. Live charging is not enabled.
