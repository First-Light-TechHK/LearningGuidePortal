# Modeling life Lesson 02 Exhibits

User request (2026-10-29): reuse both Lesson 01 Exhibits in Lesson 02; place one in the middle of text 2.1 and the other in the middle of text 2.2, and keep the same video prompt times.

Registered course-only migration: `019_add_modeling_life_lesson2_exhibits`, after Reading list migration 018. It copies the current active image nodes from Lesson 01 rather than uploading or inventing assets.

| Source Exhibit | Lesson 02 text placement | Video time |
| --- | --- | --- |
| T, W, V, C | 2.1, before “T: Well let's work on that a little bit. 2m is of course, by definition, N plus P.” | 00:37 |
| Three examples of one-dimensional state spaces | 2.2, before “S: So stability changes as A moves past K then.” | 02:40 |

These insertion points are approximately 51% and 50% through the respective original rich text. Each is a complete top-level paragraph boundary between bilingual paragraph pairs; no table, image or existing text is split or rewritten. Cards use ids `modeling-life-l2-text-exhibit-1/2` and native authored markers. Timed nodes use `modeling-life-l2-exhibit-1/2` on `modeling-life-l2-video-1`, matching Lesson 01's placement on its first shared-source video point. Trigger times are absolute media positions, not offsets relative to chapter 2.2. Video URLs/start positions are unchanged.

Exploration adds `modeling-life-exhibit-2-1/2` with lessonNumber=02, retaining the two Lesson 01 entries. This lesson has two Exhibits; Whole course has four. Text, timed video and Exploration all reuse the exact original image URLs, thumbnails, titles, descriptions and source labels. Reading lists from 018, original rich text/images, assessments and all learner/payment/access data remain unchanged. No API, schema, translation or UI-layout change is necessary.

The migration stages all edits in a cloned Course and writes once after validation. Missing Course/Lesson 02 skips without recreating data. Missing/ambiguous source nodes, target point identities, invalid markers or changed/duplicate midpoint anchors fail before writes. Existing copied nodes/cards/Exploration entries and unrelated operator entries remain intact; direct and ledger replay do not duplicate or resynchronise them. Partial copies can be completed safely.

Validation covers exact cloning and paragraph placement, original HTML preservation, original video timing, media reference recognition, preview withholding, readings/tests/history preservation, partial/repeated execution and atomic failure. Bilingual browser coverage checks both text cards/viewers on desktop/mobile, video prompts immediately before/at 37 and 160 seconds, viewer close behavior and 2/4 Exploration scoping. Existing Course media service/API tests retain signed-out, expired, foreign/unattached and thumbnail access checks. Screenshots: `test-results/modeling-life/browser/*-lesson-2-text-exhibit-*.png` and `*-lesson-2-video-exhibit-*.png`.

No live migration or deployment is part of local validation. The normal target release must apply 019 and verify its ledger and rendered data; successful startup alone is insufficient. If future content needs correction, add a new numbered migration while preserving intervening author edits and learner records. Earlier empty-Lesson-02-Exhibit smoke expectations are superseded by this request.

Local validation passed: migration/service/API regressions, bilingual browser tests, scoped ESLint and production build. The preview regression confirms Lesson 02's existing textPointCount=0 withholds both new text cards. English desktop text/video and Chinese mobile text screenshots were inspected. Target-environment execution and smoke remain pending deployment.
