# Portal — published course page

Compiled from existing unit tests. Suite is active. Overlay select runs this product_command.

## UC-PORTAL-1 Course page primitives


### Functional
- Title: Course identity comes from the product store
- Steps: Open a published course as a tourist
- Expected: Title, track, lesson count and preview flag match the store, not leftover chrome


### Negative
- Title: Unpublished or missing course is not presented as a published page
- Steps: Request a course that is not published
- Expected: Not a fabricated published identity


### Edge
- Title: Visitor syllabus is previewable versus locked
- Steps: Open the published course with no entitlement
- Expected: Public first lesson is previewable; remaining lessons stay locked
- Title: Paid access still reads identity from the store
- Steps: Purchase the course; open the course page
- Expected: Title and track still come from the store, not leftover chrome
- Title: Published HTTP detail matches store identity and locks private lessons
- Steps: GET /api/portal/courses/epicureanism with no cookie
- Expected: `pageState=available`; title Epicureanism; one previewable openable lesson; remaining lessons locked
- Title: Plan amounts are server catalogue values
- Steps: GET /api/portal/plans; compare epicureanism-pc-6 and everything-pc-6
- Expected: `amountMinor` is 4900 and 9900; INV-browser-not-price
- Title: Locale query does not invent unpublished courses or client prices
- Steps: GET /api/portal/courses?locale=en-GB and ?locale=zh-CN; GET /api/portal/plans?amountMinor=1
- Expected: Same published id list; no plan uses amountMinor 1
