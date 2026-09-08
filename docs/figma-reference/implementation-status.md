# Portal UI implementation status

## Design sources

- Figma file: XZXdAKkeT9yVuLeaaqzZFC, page 0:1.
- Change requests: 页面_功能修改.pptx and 页面&功能修改.xlsx supplied by the project owner.
- Retrieved design context: visitor Header 2007:179, Overview 131:472, Personal Settings 131:182. Raw references and page inventory are in this directory.
- Live Figma MCP reads remain limited, but the supplied local exports were decoded on 8 September. Offline layer inspection is now available: `1 (Copy).fig` contains 1,964 nodes and 16 embedded images; `LearningGuide (Copy).fig` contains 25,751 nodes and 106 embedded images. Exact visual acceptance is still not complete; successful decoding and browser tests do not establish pixel equivalence.
- Extracted inventories, text/layout data and original image bytes are under `outputs/figma-local/20260908-portal` and `outputs/figma-local/20260901-learning-guide` in the parent workspace. The newer file includes the same portal node IDs as the supplied online file; the earlier file provides broader demo, prototype and UI pages. Excel/PPT changes continue to govern requested behaviour; an export date alone does not resolve a conflicting requirement.
- Reproducible extraction: `scripts/extract-fig-reference.mjs`, using [openfig-core 0.4.1](https://github.com/OpenFig-org/openfig-core), installed separately from application dependencies. `FIG_PARSER_MODULE` can point at its installed module. Local parsing exposes source properties; instance inheritance and rendering must still be checked rather than assuming every raw field directly corresponds to CSS.

## Implemented

| Area | Changes |
| --- | --- |
| Header and navigation | Supplied logo asset; local Inter fonts; header dimensions; signed-in Courses header; account navigation and selected state; mobile sign-in remains visible. |
| Homepage and Courses | Three banners, three-second rotation and one CTA per banner; View all below the course grid; shared category display labels. |
| Portal configuration | Operator-only `/backoffice/portal` screen and `/api/backoffice/portal` GET/PUT; bilingual banner text, images and destinations; category labels, country list and support URL. Persisted through the existing product store. |
| My Learning | Left navigation; removal of the unrelated Overview side column; course card dimensions and mobile layout. |
| Personal Settings | JPG/PNG validation, 5 MB limit, square centre crop, avatar refresh; nickname constraints; configured country choices with browser-region suggestion; maximum five interests; disabled device and email settings retained. |
| Footer, Help and Contact | Four-column footer; shared course categories; public Help placeholder requested by the attachment; Contact opens the configured support URL. An operator must supply a real support destination. |
| Purchase | Independent plan radio groups; selected plan retained through login and registration; failed/cancelled local payments and cancelled Stripe Checkout return to the original quote. All three consents remain mandatory. |
| Subscription recovery | Pay now requests the selected subscription's open Stripe invoice. Ownership, invoice status and payment URL are checked server-side. Update payment method selects that subscription's customer portal. |
| Local authentication | Session and OAuth cookie policy permits HTTP only with explicit APP_ENV=DEV on localhost, 127.0.0.1 or ::1. Other environments and remote hosts retain Secure cookies. |

## Acceptance still outstanding

1. Use the recovered local screens to compare precise spacing, typography, assets and interaction states. Pricing and confirmation/cancellation dialogues are now available for inspection and still need implementation comparison.
2. Confirmation now uses a native modal over Pricing, with the measured 720px width, 32px side padding and separate plan/payment/consent/action sections. Full visual acceptance is still pending: artwork and complete renewal details must be reconciled with actual billing data, and its measured vertical layout needs further comparison.
3. Complete the Personal Settings section layout against its full design, including a user-adjustable crop if required. Current cropping is automatic and centred.
4. Complete subscription payment-history reconciliation: one record per successful payment with the correct service period, not just a list of current subscriptions.
5. Verify Overview with withdrawn courses and a failing progress request; verify video-duration figures against actual lesson media metadata.
6. Exercise operator configuration save/reload with an authorised operator. Unauthorised GET and PUT are tested; no operator credentials were assumed.
7. Verify live Google/WeChat callbacks and Stripe test-mode checkout, invoice recovery and webhooks with the configured provider accounts. Local-mode tests are not provider acceptance tests.
8. Agree named minimum browser versions. Current Chromium, Firefox and Playwright WebKit are tested; this does not certify older physical Safari/iOS devices.

## Reproducible checks

Shared footer update: `scripts/verify-footer-design.mjs` passes against the built app for Pricing node 131:955. Confirmed heading x positions 100/560/795/1030 and y=54, copyright x=1030/y=150, divider y=216, social labels y=238, footer height=306, and background RGB(18,51,125). Responsive overflow checks pass at 768/390/320. Screenshot: `/tmp/lg-footer-measured.png`. The social labels are plain text, as the supplied layer has no verified account destinations; they must not be represented as working social links. Other pages' footer colour variants and whole-page pixel comparisons remain pending.

Pricing has been rebuilt as the two-card comparison from node 131:892, with independent term controls and category selection. A browser measurement confirmed both desktop cards at 570x552. The local catalogue's actual prices and available categories are retained. Course-specific and mobile offers remain reachable via their explicit pricing parameters. The offline renderer `@grida/refig` produced `/tmp/lg-pricing-figma.png`; `/tmp/lg-pricing-actual.png` captures the implementation before the latest one-pixel header adjustment. These renders reveal remaining footer, typography and content differences and do not prove whole-page pixel equivalence. Renderer output must also be checked against source properties: its text wrapping is not necessarily identical to Figma.

Latest local verification, 8 September 2026: production build passed; Chromium, Firefox and WebKit passed the bilingual four-width browser suite against `next start`; payment-return and product smoke suites passed; isolated billing and 40 cookie-policy cases passed. Lint reports no errors and six image-optimisation warnings. Runtime configuration remained DEV/local/demo throughout these checks.

Run browser and local payment checks against an explicitly configured DEV instance. They create disposable test users and local orders in that instance. Do not point them at customer production data.

```sh
npx tsc --noEmit
npm run lint
npm run build
npm run start -- --port 3011
node scripts/verify-portal-design.mjs
node scripts/verify-payment-return.mjs
npm run smoke:product
node scripts/verify-billing-recovery.mjs
node scripts/verify-cookie-policy.mjs
```

Stop `next dev` before building in the same checkout. Do not share `.next` between concurrent development and production builds.

## Personal Settings verification, 9 September 2026

Rebuilt Profile and Personal details from local Figma node 131:182, preserving the revised JPG/PNG 5 MB limit and disabled device/email controls. Profile is x=344/y=214, 946x300; Personal details is x=344/y=534, 946x337. Online design-context access was attempted again and remains rate-limited. The downloaded file supplies the section and field measurements.

The interests field now uses a native details dropdown and labelled checkboxes, with at most five selections. Existing stored values remain unchanged. Age, education and interest option labels and client-side validation messages are translated. Profile changes still use the existing server endpoint. Existing password, language and Google connection functionality is retained; the entire Settings page is not yet claimed as an exact visual match, including the avatar crop interaction and lower sections.

`node scripts/verify-settings-design.mjs` passes on Chromium, Firefox and WebKit after the final build: section measurements (0.1px tolerance for browser rounding), invalid image type rejection, five-interest limit, save/reload persistence, read-only email, and English/Chinese overflow checks at 768/390/320. Screenshots are `/tmp/lg-settings-chromium.png`, `/tmp/lg-settings-firefox.png` and `/tmp/lg-settings-webkit.png`. No live OAuth action is performed.

The focused test waits for page requests to settle. Separate rapid full-page navigation still reproduces WebKit RSC prefetch access-control errors, including when leaving Portal for Pricing. This is not resolved or filtered out; the focused test does not supersede that outstanding finding.

## Overview verification, 9 September 2026

Corrected the inherited content grid gap and duplicate current-lesson text. The course description uses a single-line summary with its full text retained in the title attribute. Access labels now reflect actual entitlements; category labels use the configured English/Chinese translations.

`node scripts/verify-overview-design.mjs` passes against the rebuilt DEV/local/demo application. The test registers a user, checks the empty account, completes a local paid order, records lesson activity, and verifies Figma node 131:472: card x=344/y=294, width=946/height=178; title x=570/y=322; progress x=570/y=412 within 0.1px browser rounding; action x=1065/y=358. It awaits image decoding before the screenshot and checks both languages at 768/390/320. Screenshot: `/tmp/lg-overview-actual.png`.

Production build and bilingual local payment-return tests passed. Chromium and Firefox passed the broader four-width suite before the final access-label change. WebKit failed that suite and a separate rerun with RSC prefetch access-control errors; this remains unresolved and supersedes the earlier all-browser result. No errors were filtered out. Preview-course states, remaining account screen differences, and whole-site visual equivalence are still pending. These tests do not verify live payment or identity providers.

- Browser suite: registration, account menu, sign-out, Courses and four account pages; English and Chinese; widths 1440, 768, 390 and 320; horizontal overflow and JavaScript errors. Screenshots and results are written to `/tmp/learning-guide-ui-verification`.
- Payment-return suite: cancellation and failure preserve the quote; consent requirements; no access from unpaid orders; unauthorised portal configuration is rejected.
- Billing-recovery suite: mocked Stripe SDK responses, including ownership mismatch and paid/missing invoices. No network payment is performed.
- Cookie-policy suite: 40 environment/protocol/host combinations. The two isolated `.mjs` suites importing TypeScript require a Node version with native type stripping, as provided by the current local Node 26 runtime.
- Product smoke suite uses local social-login and payment substitutes. Its passing result must not be described as live Google, WeChat or Stripe verification.
