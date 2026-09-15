# Payment Management

Black-box I/O against quote, checkout, demo confirm, trial, subscription, entitlement check, and `/api/payment/webhook`.
Suite is active. Overlay select runs this product_command. PAY-01..07 Stripe internals stay specified.

PAY-01..07 Stripe internals stay specified. Executable I/O covers the HTTP-visible subset in demo and webhook authenticity.

## PAY-01 Trial zero invoice


### Functional
- Title: Completed demo trial stays inside three days
- Steps: Sign in; POST trial quote; POST /api/trial; POST demo confirm `complete`; GET entitlements
- Expected: `source` is trial; `validTo` stays inside the 3-day window, not a 6-month purchase


### Negative
- Title: Cancelled demo trial grants nothing
- Steps: Same checkout; POST confirm `cancel`
- Expected: Order `canceled`; entitlement stays false; INV-unauth-no-grant for the unpaid path


### Edge
- Title: Trial quote amount is zero
- Steps: POST quote `kind=trial` with a client `amountMinor`
- Expected: `quote.amountMinor` is 0; INV-browser-not-price
- Title: A second trial complete keeps the original three-day validTo
- Steps: Complete a demo trial twice; GET entitlements
- Expected: `validTo` does not move; still trial, not a longer purchase
- Title: Service-level $0 invoice.paid on a trialing subscription does not convert
- Steps: `tests/unit/pay-invariants.test.ts` `convertStripeTrial(amountMinor: 0)` and `applyVerifiedStripeEvent` `$0` `subscription_create`
- Expected: source stays trial; no purchase subscription. This is the PAY-01 Stripe-internal lock, not HTTP.
## PAY-02 Upgrade source cancel


### Functional
- Title: Upgrade without a source subscription is rejected
- Steps: Sign in; POST /api/subscription/quote `kind=upgrade` with a missing subscription id
- Expected: HTTP 400. Stripe cancel of the source subscription remains specified until live Stripe I/O exists


### Negative
- Title: Checkout without a session
- Steps: POST checkout with no cookie
- Expected: HTTP 401 `{ ok: false, error: "Sign in is required." }`; INV-unauth-no-grant


### Edge
- Title: Checkout without consents
- Steps: Signed-in quote; POST checkout without consents
- Expected: HTTP 400
- Title: Upgrade quote for another user's subscription is 400
- Steps: Buyer A completes a category plan; buyer B POSTs upgrade with A's subscription id
- Expected: HTTP 400

- Title: Purchase quote with kind upgrade is 400
- Steps: Sign in; POST /api/purchase/quote `{ kind: "upgrade", planId, subscriptionId }`
- Expected: HTTP 400. Upgrade quotes use POST /api/subscription/quote

- Title: Checkout from a foreign origin is 403
- Steps: Sign in; POST /api/purchase/checkout and /api/trial with `origin: https://evil.test`
- Expected: HTTP 403
## PAY-03 Double checkout


### Functional
- Title: The same quote reuses one pending order
- Steps: Quote; POST checkout twice with the same quote id
- Expected: Same `order.id`; entitlement still false


### Negative
- Title: Quote amount is server-owned
- Steps: POST quote with client `amountMinor: 1`
- Expected: Response amount is the catalogue amount; INV-browser-not-price


### Edge
- Title: Checkout order amount matches the server quote
- Steps: POST checkout with consents
- Expected: `order.amountMinor` matches the quote; local checkout URL; no grant yet
- Title: Overlapping checkouts of one quote still share one order
- Steps: Two parallel POST checkout with the same quote id
- Expected: Same `order.id`; entitlement still false. Same-process `editData` queues the writes.
- Title: Two processes checking out one quote share one order
- Steps: Two worker processes call createPendingDemoOrder on the same product.json
- Expected: Same `order.id`. This is the file-lock proof, not the in-process queue.
## PAY-04 Refund revive


### Functional
- Title: Unpaid signed completion grants nothing
- Steps: POST webhook `checkout.session.completed` with `payment_status=unpaid`
- Expected: HTTP 200 `pending`; entitlement false. Operator refund + later `invoice.paid` remains specified


### Negative
- Title: Paid event without a server order
- Steps: Signed paid completion whose metadata does not match a stored order
- Expected: HTTP 400; entitlement stays false; INV-one-charge


### Edge
- Title: Live event in sandbox
- Steps: Signed event with `livemode: true` while `STRIPE_SANDBOX=1`
- Expected: HTTP 500. The event is rejected; stripe-sandbox unit tests lock this status
- Title: Unpaid then a later paid orphan still grants nothing
- Steps: Signed unpaid completion; later signed paid completion whose metadata matches no order
- Expected: Second call HTTP 400; entitlement stays false
## PAY-05 Webhook replay


### Functional
- Title: Repeating complete does not create a second grant
- Steps: Demo confirm `complete` twice on the same order
- Expected: Still allowed once; INV-one-charge. Table UNIQUE on stripe_events remains specified


### Negative
- Title: Missing STRIPE_WEBHOOK_SECRET
- Steps: POST webhook with `STRIPE_WEBHOOK_SECRET` unset
- Expected: HTTP 503
- Title: Secret present, no stripe-signature
- Steps: Set `STRIPE_WEBHOOK_SECRET`; POST webhook with no `stripe-signature` header
- Expected: HTTP 400


### Edge
- Title: Same signed unknown event twice
- Steps: Signed `ping` with the same event id twice
- Expected: Both HTTP 200 `ignored`
- Title: The same signed unpaid completion stays pending twice
- Steps: POST the same unpaid `checkout.session.completed` event id twice
- Expected: Both HTTP 200 `pending`; entitlement false

- Title: Duplicate signed paid completion does not create a second grant
- Steps: Demo purchase; signed `ping` twice; signed paid `checkout.session.completed` twice with the same event id
- Expected: Entitlement still allowed once; second responses 200. Demo orders have no Stripe session id
- Title: Unsigned or junk-signature webhook writes nothing
- Steps: Sign in; POST webhook with no signature, then with `stripe-signature: t=1,v1=deadbeef`
- Expected: Both HTTP 400; entitlement false; GET /api/subscription is empty
- Title: Concurrent demo complete of one order grants once
- Steps: Quote; checkout; two parallel POST demo confirm `complete`
- Expected: One subscription row; entitlement allowed once; INV-one-charge
## PAY-06 Grace D+3


### Functional
- Title: Bad webhook signature
- Steps: POST webhook with a junk signature after configuring the signing secret
- Expected: HTTP 400. Grace = original expiry + 3 days remains specified


### Negative
- Title: payment_failed for an unknown subscription
- Steps: Signed `invoice.payment_failed` for a missing subscription
- Expected: HTTP 500; entitlement stays false. The webhook cannot reconcile an unknown Stripe subscription in the I/O harness. Do not treat 200 or 400 as pass. Grace = original expiry + 3 days remains specified.


### Edge
- Title: Unknown event type
- Steps: Signed `ping`
- Expected: HTTP 200 `ignored`
- Title: payment_failed without a subscription field grants nothing
- Steps: Signed `invoice.payment_failed` with no subscription
- Expected: No entitlement grant
- Title: Service-level graceEndsAt is original validTo + 3 days
- Steps: `tests/unit/pay-invariants.test.ts` `markStripeSubscriptionGrace` after a paid 6-month term
- Expected: `graceEndsAt = original validTo + 3 days`; paid validTo is not collapsed to now+3 days
## PAY-07 Invoice unsets cancel


### Functional
- Title: Cancel at period end keeps access
- Steps: Complete a demo purchase; POST /api/subscription `cancel`; GET entitlements
- Expected: HTTP 200; entitlement stays true until the period ends. `invoice.paid` must not clear cancel_at_period_end remains specified


### Negative
- Title: A paid purchase cannot be resumed
- Steps: Cancel; POST `resume`
- Expected: HTTP 400; cannot be restored


### Edge
- Title: Resume without a subscription id
- Steps: POST /api/subscription `{ action: "resume" }`
- Expected: HTTP 400
- Title: Cancelling a paid purchase twice still keeps access
- Steps: Complete a demo purchase; POST cancel twice; GET entitlements
- Expected: Entitlement stays true until the period ends
- Title: Service-level invoice.paid does not clear cancel_at_period_end
- Steps: `tests/unit/pay-invariants.test.ts` cancel then `applyStripePaidInvoice` / `applyVerifiedStripeEvent` invoice.paid with `cancelAtPeriodEnd: false`
- Expected: Local subscription remains `cancel_at_period_end`; paid purchase still cannot resume
## PAY-08 Overlap delete


### Functional
- Title: Overlapping purchase still allows the course
- Steps: Complete a course plan; complete a covering category plan; GET entitlements
- Expected: `allowed` is true


### Negative
- Title: Quote or checkout without a session
- Steps: POST quote and checkout with no cookie; GET entitlements and GET /api/subscription with no cookie
- Expected: HTTP 401 `{ ok: false, error: "Sign in is required." }`; INV-unauth-no-grant


### Edge
- Title: Previous subscription row remains
- Steps: After the overlapping purchase; GET /api/subscription
- Expected: Both plan ids are still listed; previous row is not filter-deleted
- Title: An overlapping purchase does not expire the first subscription row
- Steps: Complete a course plan; complete a covering category plan; GET /api/subscription
- Expected: First plan row is still listed and not `expired`; course check stays allowed
- Title: Service-level overlapping purchase expires the previous entitlement row
- Steps: `tests/unit/pay-invariants.test.ts` course then category complete; read product.json entitlements
- Expected: Previous entitlement id remains with `state=expired`; exactly one active row
## PAY-09 Device and repurchase


### Functional
- Title: PC entitlement does not allow a mobile device check
- Steps: Complete a PC course plan; GET entitlements `device=pc` and `device=mobile`
- Expected: PC allowed; mobile not allowed


### Negative
- Title: Same plan cannot be quoted while access is active
- Steps: Complete a plan; POST quote for the same plan
- Expected: HTTP 400; already has active access; INV-browser-not-price for client amount on a fresh quote


### Edge
- Title: Signed-in without purchase is not entitled
- Steps: Register; GET entitlements
- Expected: HTTP 200; `allowed` is false
- Title: A client amount cannot reopen a quote while access is active
- Steps: Complete a plan; POST quote for the same plan with `amountMinor: 1`
- Expected: HTTP 400; client amount is ignored
## PAY-10 Demo revive


### Functional
- Title: Completed demo trial allows the course
- Steps: POST trial; POST confirm `complete`; GET entitlements
- Expected: Confirm 200 `paid`; `allowed` is true


### Negative
- Title: Second complete after trial cancel does not revive
- Steps: Complete trial; POST subscription cancel; POST confirm `complete` again
- Expected: Confirm 400; entitlement stays false; INV-one-charge


### Edge
- Title: Trial checkout without consents
- Steps: POST /api/trial without consents
- Expected: HTTP 400
- Title: Completing after a demo trial cancel does not grant access
- Steps: POST trial; POST confirm `cancel`; POST confirm `complete`
- Expected: Confirm 400; entitlement stays false
- Title: Two processes starting one trial quote share one order
- Steps: Two worker processes call createPendingDemoTrialOrderFromQuote on the same product.json
- Expected: Same `order.id`

Specified / not tested now (prose, not a function_id): no live Stripe in this suite. Do not treat demo `order.id` reuse or webhook fixtures as these proofs: PAY-01 true `$0 invoice.paid` on a trialing Stripe subscription; PAY-02 Stripe cancel of the source subscription; PAY-03 a second Stripe Checkout Session (`sessions.create`); PAY-04 operator refund then later `invoice.paid` revive; PAY-05 table UNIQUE on `stripe_events`; PAY-06 grace = original `validTo` + 3 days; PAY-07 `invoice.paid` clearing `cancel_at_period_end`; PAY-08 Stripe resync `filter()` deleting the previous entitlement row. AUTH-04 Google signup promotion stays specified until a real OAuth path exists.
