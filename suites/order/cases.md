# Order Management

Black-box I/O against `/api/backoffice/orders`.
Suite is active. Overlay select runs this product_command.

Student and unauthenticated callers cannot list or refund orders. Operator refund + later `invoice.paid` must not revive access; that hop is specified until an operator seed exists.

Register always creates a student. `BACKOFFICE_OPERATOR_EMAIL` is unused for role. There is no public operator seed, so operator refund HTTP is blocked.

## ORDER-01 Student cannot operate orders


### Functional
- Title: A student session cannot list backoffice orders
- Steps: Register; GET /api/backoffice/orders
- Expected: HTTP 403. Do not weaken this status.


### Negative
- Title: A student cannot refund
- Steps: Register; quote; checkout; demo confirm `complete`; POST /api/backoffice/orders `{ action: "refund" }`
- Expected: HTTP 403. The paid order stays unpaid-from-operator; student 403 is not a refund.


### Edge
- Title: Unauthenticated orders list
- Steps: GET /api/backoffice/orders with no cookie
- Expected: HTTP 403 `{ ok: false }` and Course Manager/Operator error
- Title: Unauthenticated refund is not an operator hop
- Steps: POST /api/backoffice/orders `{ action: "refund" }` with no cookie
- Expected: HTTP 403
## ORDER-02 Refund revive


### Functional
- Title: Operator refund then later invoice.paid must not revive
- Steps: Specified HTTP. Service lock: `tests/unit/refund-then-invoice.test.ts` and `tests/unit/pay-invariants.test.ts` refund then `applyVerifiedStripeEvent` invoice.paid
- Expected: Entitlement stays false after the invoice. HTTP still not executable: no operator seed; register stays student; `BACKOFFICE_OPERATOR_EMAIL` does not grant `role=operator`


### Negative
- Title: Student refund is not the operator hop
- Steps: Same as ORDER-01 negative
- Expected: HTTP 403. This does not prove ORDER-02 revive; it only proves the student cannot start the refund


### Edge
- Title: Operator refund HTTP is blocked
- Steps: There is no public register/login that yields `isOperator`
- Expected: Specified / blocked until an operator seed exists. Do not weaken student 403 to invent an operator path
