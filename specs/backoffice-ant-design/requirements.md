# Backoffice Ant Design requirements

Base: local `dev` commit `56fad17`; working branch `feat/backoffice-ant-design`.
The user authorised a plan followed by incremental implementation in this turn.

1. When an Operator opens Orders, Payment, Portal or Courses, the existing data, permissions, actions and error/retry paths shall remain available through Ant Design controls. Teacher navigation and course ownership remain server-controlled.
2. When a learner visits Portal or My Learning, the migration shall retain existing typography, geometry and assets. No database, service, payment or API behavior is changed.
3. When a migrated page is displayed at 390px, lists shall use readable cards, filters and navigation shall open in drawers, and forms shall use one column without viewport overflow. Desktop retains tables and the existing sidebar/header identity.
4. When a popup opens, its styles, locale, stacking, scrolling, Escape handling and return focus shall remain correct in the Backoffice context.
5. When either UI locale is selected, all business copy shall come from existing native-i18n messages; library pagination/validation copy shall use the matching locale.
6. Every migrated flow shall retain service/API regressions and gain browser evidence for interaction, failure/retry and mobile presentation. Production build is required; target-environment smoke and exact Figma visual acceptance remain separate gates.

Scope: provider/SSR styling; Orders; Payment; Portal CMS controls/image dialog; Course list/create/ownership/catalogue; admin sign-in; shell. Course content authoring/player, legacy AI tools and learner pages keep their specialised components.
