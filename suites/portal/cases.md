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

## UC-PORTAL-CATEGORY Course category surfaces

Sits beside UC-PORTAL-1 course identity. The course page still reads identity from the store. These leaves are the visible category: breadcrumb, title chip, catalogue filter and card, home card, My Learning meta, public-lesson recommendation, and pricing group. INV-course-own-category.


### Functional
- Title: Stored categoryId is the locale label and the portal category id
- Steps: Open a science course, a European humanities course, and a Chinese humanities course in en-GB and zh-CN
- Expected: Breadcrumb is Home / Courses / category label / course info. The category href query is `Science`, `European Humanities`, or `Chinese Humanities`. Visible text is `Science`/`科学`, `European Humanities`/`欧洲人文`, `Chinese Humanities`/`中国人文`. The same id and label are the title chip, the active catalogue chip, the catalogue and home card line, the My Learning meta category, the public-lesson recommendation, and the pricing group. INV-course-own-category


### Negative
- Title: A legacy field or a catalogue name for the other category does not move the surface
- Steps: Store categoryId `science` or `European Humanities` while the legacy category and the catalogue entry name say the other category
- Expected: Display stays on the categoryId. A science course is not listed or grouped under European Humanities, and its visible text is not `欧洲人文` or `European Humanities`. A humanities course is not shown as `科学` or `Science`.


### Edge
- Title: A missing category is omitted, and a subject does not replace the category crumb
- Steps: Open a course with no category. Open a poetry subject under humanities and a biology subject under science with no categoryId
- Expected: With no categoryId, no subject parent, and no exact legacy id, the category crumb, chip, card line, meta category, recommendation category and pricing group are absent. Poetry whose catalogue parent is european-humanities shows European Humanities, not Poetry. Biology whose catalogue parent is science shows Science, not Biology. A humanities course whose subject is biology still shows European Humanities, not Science.
