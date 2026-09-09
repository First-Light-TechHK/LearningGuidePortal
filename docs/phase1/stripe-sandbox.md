# Stripe sandbox configuration and verification

## Scope

This configuration uses Stripe test keys and local LG storage. No AWS configuration, live Stripe price, live subscription or account-wide Managed Payments setting was changed.

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
