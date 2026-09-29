# Video preview visual verification

- Reference: [LG-m2, 2027:1191](https://www.figma.com/design/R38nBcRPu8Q97V5S0jQcAr/LG-m2?node-id=2027-1191).
- Route: `/{locale}/portal/courses/{courseId}/public-lesson`.
- Reused components: PortalHeader, PortalFooter, LessonContentPlayer, PreviewProgress, existing lesson/trial modals. The header's notification entry remains the project's shared component.
- At 1440px, the layout uses a 324px sidebar, a 696×410px video stage and a 296px tools panel. Static tool/banner copy follows the design and has en-GB/zh-CN translations.
- Course titles, descriptions, outline length, content/exhibits and video poster remain server data. The sample Figma cover is not substituted for actual course imagery. All new icons are the design's text glyphs; no temporary Figma asset URLs are used.
- The real native video controls, interactive node links, completion action and next-preview action are retained. These extra working controls affect banner placement when the lesson contains interactive nodes. Preview length remains the existing 60 seconds, not the design's illustrative 20 minutes.
- Local screenshots inspected: `test-results/preview-video/en-GB-desktop.png`, `zh-CN-desktop.png`, `en-GB-mobile.png`, `zh-CN-mobile.png`. Narrow-screen overflow checks passed at 768, 390 and 320px. Mobile is a responsive adaptation, not a separately supplied Figma layout.
- Verification: `NEXT_DIST_DIR=.next-ui-check npm run build`; 11 service/outline tests; `scripts/verify-preview-video.ts` against disposable local data. Browser checks cover anonymous/private access, actual playback, synthetic time-update enforcement of the 60-second boundary, content switching, preview completion, entitled exercise/exhibit tools and expired access.
- Target-environment smoke and final product acceptance remain pending.
