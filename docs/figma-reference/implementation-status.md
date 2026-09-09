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

1. Complete whole-page comparisons for course detail, lesson pages, Homepage, About Us and the remaining account sections. Selected rectangle assertions are not whole-page pixel equivalence.
2. Confirmation's section rectangles and keyboard behaviour are tested. Final billing/legal wording still needs reconciliation with the actual provider implementation; sample billing dates are not production data.
3. Complete the Personal Settings section layout against its full design, including a user-adjustable crop if required. Current cropping is automatic and centred.
4. Finish cancellation-dialog interior measurements and the existing-category upgrade Pricing layout.
5. Verify Overview's failed-progress-request behaviour and anonymous preview-history requirements. Signed-in preview recording, payment-history rows and measured video-duration aggregation are tested.
6. Reconcile all revised Subscription v1.6 business rules, including duplicate purchase prevention and scheduled renewal behaviour, before production acceptance. Local UI tests do not certify the live billing lifecycle.
7. Live Google/WeChat callbacks and Stripe test-mode checkout, invoice recovery and webhooks are **deferred by the project owner** (9 September: “skip first”). This is not a passing result and must remain a production acceptance item.
8. Agree named minimum browser versions. Current Chromium, Firefox and Playwright WebKit are tested; this does not certify older physical Safari/iOS devices.

## Reproducible checks

### Current results, 9 September 2026

The following results supersede the earlier incremental notes below about unresolved WebKit prefetch errors, missing subscription history and untested operator configuration. Tests ran against DEV/local/demo; none used live identity or payment providers.

| Check | Result and coverage |
| --- | --- |
| `verify-portal-design.mjs` | Passed Chromium, Firefox and WebKit; English/Chinese; 1440/768/390/320 widths; navigation, account menu, local registration/logout and overflow. |
| `verify-catalogue-navigation.mjs` | Passed all three browser engines; three-column desktop geometry, category filtering, locale path/query preservation and rapid page navigation without JavaScript errors. |
| `verify-subscription-design.mjs` | Passed all three engines in both languages; separate successful-payment rows, actual amounts and receipts, stored service periods, one current subscription action and responsive layout. Unknown historical periods remain explicitly unknown. |
| `verify-preview-progress.mjs` | Passed signed-in preview open/complete, idempotent completion, access rejection and history preservation after local purchase. Anonymous history merging is not covered. |
| `verify-course-duration.mjs` | Passed eight isolated cases. Video duration is aggregated from explicit media seconds, never inferred from estimated study time. |
| `verify-operator-configuration.mjs` | Passed in an isolated temporary DEV instance: unauthorised rejection, operator edit/save/reload, public banner update, lesson duration validation and published course duration. Existing developer data was not modified. |
| `verify-upgrade-design.mjs` | Passed all three engines in both languages: actual paid credit, selected Category upgrade, inherited expiry, idempotent local fulfilment, other subscription preservation and paid-renewal resume rejection. This does not verify a Stripe subscription change. |
| `verify-auth-design.mjs` | Passed all three engines after the divider fix: form x=448.5/y=311, 448x464; provider row y=701, height=32; email-first/password flow, password visibility, selected-plan return, remember-me/session cookie behaviour, unsafe return-path rejection and responsive overflow. |

Implemented changes include shared catalogue cards; optional `videoDurationSeconds` on lessons; signed-in public-lesson progress through `/api/study/preview`; explicit order service-period snapshots; full paid-amount upgrade credit instead of daily proration; and independent session/persistent sign-in cookies. Google, WeChat and Stripe tests remain deferred, not simulated acceptance.

### Earlier incremental measurements

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

## Subscription dialogs, 9 September 2026

Confirmation now separates the plan type and category, includes scope benefits and a payment/renewal grid, and retains server quote amounts. Unconfirmed billing dates are not copied from the Figma sample. Consent wording remains the application's existing wording; billing dates and the legal-copy differences still require review before claiming exact whole-dialog equivalence.

`verify-confirmation-design.mjs` passes on Chromium, Firefox and WebKit in English and Chinese. At 1440x1162 the dialog is x=360/y=72, 720x894. Relative section rectangles are: plan 32/104/656/237; payment 32/359/656/228; confirmations 32/605/656/178; actions 32/801/656/46. The script asserts these rectangles, actual quote amount, three required consents, keyboard focus containment, Escape return to the selected plan and reachable actions without horizontal overflow at 768/390/320. Keyboard checks initially failed and led to an explicit Tab/Shift-Tab cycle shared by both native dialogs; results above are after that correction.

Cancellation uses a native dialog with body scroll locking, Escape dismissal, focus restoration, and in-dialog errors. No cancellation reason is preselected. Skip omits both reason code and any previously entered Other text. `verify-cancellation-design.mjs` passes for English/Chinese local orders, including Escape without cancellation, keyboard navigation, mobile overflow and the resulting cancel_at_period_end state. Cancellation styling is based on node 131:1165 but has not yet passed an exact interior-position comparison. Screenshots: `/tmp/lg-cancellation-en-GB.png` and `/tmp/lg-confirmation-chromium-en-GB.png`.

Final production build and local payment-return suite passed. These are DEV/demo checks, not live Stripe verification. Whole subscription-page alignment and the separate rapid-navigation WebKit prefetch errors remain outstanding.

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

## Production deployment, 9 September 2026

Production now runs from GitHub main via a single App Runner service (`learning-guide-portal`), configured with automatic deployments on push to main. Manual image builds are retired.
