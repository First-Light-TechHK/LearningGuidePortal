# UI alignment review, 9 September 2026

## Reference and limits

The Figma MCP request for `XZXdAKkeT9yVuLeaaqzZFC`, page `0:1`, was rejected because the connected View seat has exhausted its allowance. This review therefore uses the supplied `.fig` exports and the previously retrieved header design context. It does not establish whether the online design has changed since those exports.

References:

- `1 (Copy).fig`: visitor Header `2007:179`, including individual nodes listed in the test script. The earlier Figma-generated reference is saved in `header-reference.txt`.
- `LearningGuide (Copy).fig`: SignIn `121:8136`, particularly Form `121:8143` and its descendants.
- Extracted source properties: parent workspace `outputs/figma-local/20260908-portal/nodes.json` and `outputs/figma-local/20260901-learning-guide/nodes.json`.

## Measured differences corrected

Measurements are CSS pixels at a 1440 x 1024 viewport. Previous values were read from the running application before the edits.

| Element | Before | Reference and corrected value |
| --- | --- | --- |
| Authentication brand | Text `LG` beside the name | Existing exported logo component, shared by sign-in and registration |
| Header brand | Weight 780; colour #101828 | Weight 600; colour #0a0a0a |
| Header navigation | 32 px link gap | 30 px link gap |
| Language control | x=1151.72; 45.39 x 26; 12 px type; radius 5 | x=1103; 42 x 22; 14 px type; radius 4 |
| Header Get Started | x=1286.97; 113.03 x 37; radius 8 | x=1291.66; 108.34 x 36; radius 10 |
| Sign-in form | Radius 16 | Radius 14; source drop shadows |
| Email/password inputs | Radius 8; border #d0d5dd | Radius 10; border #d1d5dc |
| Field labels | Weight 400; colour #344054 | Weight 500; colour #364153 |
| Sign-in submit | Weight 700; radius 8 | Weight 500; radius 10; source blue and shadows |

The sign-in form position (448.5, 311), size (448 x 464), input positions, submit position and provider-row vertical position already matched. These were retained. Authentication routes, provider selection, error handling and session logic were not modified.

## Verification

`scripts/verify-figma-measurements.mjs` checks 66 desktop geometry/style properties per browser against explicitly identified source nodes, allowing no more than 0.55 CSS pixel rounding for numerical measurements. String-valued CSS properties must match exactly.

- Chromium, Firefox and WebKit: **198/198 desktop property checks passed**.
- Seven public routes/states, two languages, four widths and three engines: **168/168 horizontal-overflow checks passed**. These are responsive checks, not Figma image comparisons.
- Combined measurement script: **366/366 checks passed**.
- `verify-auth-design.mjs`: passed all three engines; email-first/password flow, password visibility, selected-plan return, remember-me behaviour and logout/session handling. Local test accounts only.
- `verify-portal-design.mjs`: passed all three engines; English/Chinese, 1440/768/390/320 widths, account navigation, settings, subscriptions and registration/logout. Local development data only.
- Production build: passed with existing lint warnings. UI changes remain local; they have not been deployed to AWS.

Run against an isolated development server:

```sh
NEXT_DIST_DIR=.next-ui-check npm run dev -- --port 3013
BASE_URL=http://127.0.0.1:3013 node scripts/verify-figma-measurements.mjs
BASE_URL=http://127.0.0.1:3013 node scripts/verify-auth-design.mjs
BASE_URL=http://127.0.0.1:3013 node scripts/verify-portal-design.mjs
```

Measurement JSON and desktop screenshots are saved to `/tmp/lg-figma-measurements` by default; use `OUT_DIR` to retain them elsewhere. `BROWSER` selects one engine, and `MEASURE_ONLY=1` omits responsive checks.

## Not yet accepted as pixel-equivalent

- Full-page rendered pixel comparisons, including background crop, individual glyph rendering, icons, shadows and all text baselines. Selected CSS measurements cannot establish these.
- Complete Homepage, course detail, lesson, pricing, account and subscription-modal comparisons. Passing their functional or overflow tests does not establish visual equality.
- Exact registration layout and copy: the application implements its current required fields, whereas the older Figma file has multiple registration variants. These must be reconciled with the applicable PRD, not copied from a different variant without review.
- Authentication wording differs from the older SignIn frame (for example, `Sign in` versus `Welcome back`). Copy has not been changed as part of this layout correction.
- The source provider row includes Apple, which is not implemented in the agreed Google/WeChat/email login scope. No non-functional Apple button has been introduced to imitate the image.
- Mobile/tablet behaviour is verified for overflow and operation, not against missing device-specific frames.

Restore Figma design-read access or supply full-frame 1x PNG exports to complete image comparisons. No whole-site pixel-equivalence claim is made by this review.
