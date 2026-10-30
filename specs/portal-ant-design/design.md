# Portal controls design

Use the installed Ant Design 6.6.8, with PortalProvider in portal/subscription/contact/account route layouts. No root provider, reset stylesheet or Ant Design App typography wrapper. Standalone account-menu use gets a nested-safe provider. Share lg-ant prefix with the existing narrow native-field exclusions, with independent themes (inherit:false).

PortalButton owns action semantics and pending accessibility. AntD owns base states/tokens; dedicated portal-control selectors own existing Figma variants and responsive geometry. Migrated actions do not retain portal-button classes. Existing Link/AuthNavigationLink remain navigation. Keep native forms/constraint validation and existing custom password visibility/consent controls while moving text fields to Input. Choice buttons retain aria-pressed semantics using AntD Button, including per-option disabled state; this avoids forcing radio/tab semantics onto the all-categories display.

Keep native SubscriptionConfirmation and CourseLearningModeDialog shells and their focus/backdrop behavior; migrate their action buttons. Assessment/media/reading dialogs are excluded. Account menu uses Dropdown with real Next links. API and application-service contracts are unchanged; no migrations.

Purpose: standardise learner control states and maintenance. Visual direction: existing Figma learning website. Palette #155dfc/#1d6bff/#15233a/#d0d5dd/#fff; retain Inter, existing assets and page layouts per DESIGN.md. No redesign.

Verification: existing service and page/API tests, a provider-aware bilingual browser regression with errors/retries/pending/keyboard/mobile, production build and actual Next SSR/navigation smoke. Screenshots are regression evidence, not exact Figma acceptance.
