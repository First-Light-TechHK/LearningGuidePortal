# My Learning — overview and progress

Compiled from existing unit tests. These Learning Guide ids are not Overlay kernel law.
Suite is active. Overlay select runs this product_command (store unit tests).
Signed-out HTTP I/O lives in `tests/io/my-learning.test.ts`. Store unit tests do not prove signed-out HTTP.

## ML-FR-004 Course cards


### Functional
- Title: Entitled or preview-started course appears as a card
- Steps: Sign in; open My Learning overview
- Expected: Cards follow the five-state / trial+started rules; progress is an integer 0–100


### Negative
- Title: Signed-out user is rejected
- Steps: GET /api/my-learning/overview, GET /api/entitlements/check, and POST /api/study/events with no session (`tests/io/my-learning.test.ts`)
- Expected: HTTP 401 `{ ok: false, error: "Sign in is required." }` on each; no other user's data. After register/quote/checkout/demo confirm, GET overview is 200. Expired `validTo` (unit helper `readProductData`/`writeProductData`) makes check `allowed: false` and locked study/events 403. INV-expired-no-learn GET overview stays 200.


### Edge
- Title: Purchased with no opened Learning Point does not invent a card
- Steps: Complete purchase; do not open a Learning Point
- Expected: Entitlement exists; course list stays empty (LEARN-02 lock, same leaf)
- Title: Card and unique-LP progress stay aligned
- Steps: Open one Learning Point (ML-FR-007); return to overview
- Expected: The matching course card (ML-FR-004) shows the same integer progress
## ML-FR-007 Unique Learning Point progress


### Functional
- Title: Opening a Learning Point counts once
- Steps: Open one LP on a two-LP course
- Expected: Progress 50; opened count 1


### Negative
- Title: Repeating the same Learning Point does not increase progress
- Steps: Open the same LP three times
- Expected: Still 50


### Edge
- Title: Duration / +300s inject is not the source of truth
- Steps: Complete-by-duration or burst video_progress on one LP
- Expected: Unique-LP progress unchanged
- Title: Unique-LP progress does not become time progress after refund
- Steps: Purchase; open one LP; refund; read overview
- Expected: Progress stays 50; not a duration percentage
