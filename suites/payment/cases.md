# Payment Management

Black-box I/O against quote, checkout, demo confirm, trial, subscription, entitlement check, and `/api/payment/webhook`.
Suite stays draft so Overlay does not run these cases and does not go red.

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

## PAY-02 Upgrade source cancel

### Functional
- Title: Upgrade without a source subscription is rejected
- Steps: Sign in; POST quote `kind=upgrade` with a missing subscription id
- Expected: HTTP 400. Stripe cancel of the source subscription remains specified until live Stripe I/O exists

### Negative
- Title: Checkout without a session
- Steps: POST checkout with no cookie
- Expected: HTTP 401; INV-unauth-no-grant

### Edge
- Title: Checkout without consents
- Steps: Signed-in quote; POST checkout without consents
- Expected: HTTP 400

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
- Expected: HTTP 400

## PAY-05 Webhook replay

### Functional
- Title: Repeating complete does not create a second grant
- Steps: Demo confirm `complete` twice on the same order
- Expected: Still allowed once; INV-one-charge. Table UNIQUE on stripe_events remains specified

### Negative
- Title: Missing signature
- Steps: POST webhook with no `Stripe-Signature` and no secret
- Expected: HTTP 503

### Edge
- Title: Same signed unknown event twice
- Steps: Signed `ping` with the same event id twice
- Expected: Both HTTP 200 `ignored`

## PAY-06 Grace D+3

### Functional
- Title: Bad webhook signature
- Steps: POST webhook with a junk signature after configuring the signing secret
- Expected: HTTP 400. Grace = original expiry + 3 days remains specified

### Negative
- Title: payment_failed for an unknown subscription
- Steps: Signed `invoice.payment_failed` for a missing subscription
- Expected: No entitlement grant

### Edge
- Title: Unknown event type
- Steps: Signed `ping`
- Expected: HTTP 200 `ignored`

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

## PAY-08 Overlap delete

### Functional
- Title: Overlapping purchase still allows the course
- Steps: Complete a course plan; complete a covering category plan; GET entitlements
- Expected: `allowed` is true

### Negative
- Title: Quote or checkout without a session
- Steps: POST quote and checkout with no cookie
- Expected: HTTP 401; INV-unauth-no-grant

### Edge
- Title: Previous subscription row remains
- Steps: After the overlapping purchase; GET /api/subscription
- Expected: Both plan ids are still listed; previous row is not filter-deleted

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
