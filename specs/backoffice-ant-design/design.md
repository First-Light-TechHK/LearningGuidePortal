# Backoffice Ant Design design

## Purpose and visual direction

Support Teacher content work and Operator transactions using consistent forms and tables. Preserve the existing utilitarian Backoffice structure and Figma-driven identity: primary #155dfc, text #101828, secondary text #4a5565, borders #e5e7eb, surfaces #ffffff/#f9fafb; Inter and existing lucide icons. Existing project fonts/brand override generic skill defaults. Desktop keeps the header/sidebar/content arrangement; mobile has a drawer menu and stacked content. This is a component migration, not a new Pro-template design. Exact Figma matching is pending; local screenshots cannot certify it.

## Integration and styles

- Pin published Ant Design 6 and the official Next.js registry. Put the registry, high-priority StyleProvider, ConfigProvider and App in a client BackofficeProvider used only by the Backoffice layout and authenticated admin knowledge boundary.
- `prefixCls=lg-ant`, separate theme and native-i18n locale mapping. Do not import antd reset.css, do not change the root layout or layer/reorder all learner CSS.
- Existing global reset/inheritance remains. Exclude `lg-ant-` input/textarea/select classes only from old generic field-decoration rules; retain those rules for native authoring and learner inputs. Ant Design owns its control borders, padding, focus, disabled state and checkbox/radio geometry. CSS Modules own page layout.
- Do not attach legacy portal-button/auth-input classes to Ant Design controls. Use theme tokens and component props first; any bridge CSS is namespaced under `.backoffice-ui`.
- Popup containers resolve to a dedicated host inside `.backoffice-ui`, outside the scrollable content panel. Modal/Drawer receive that host explicitly. No arbitrary body reset or global z-index overrides. Use context-bound modal APIs.
- Desktop tables and CSS-switched mobile cards share actions/state, not separate business implementations. Existing APIs and service-derived amounts/permissions remain authoritative.

## Data/API and verification

No DDL, service write, endpoint or response contract change. Extract the current Orders presentation DTO into a frontend contract. Existing optimistic course timestamps, refund/resynchronisation requests, CMS upload/cancellation and auth cookies remain.

Verify existing access/authoring/order/CMS service/API tests; browser component regressions for controls and mocked failures; actual Next rendering on disposable local data; desktop/mobile and both locales; Portal before/after geometry/screenshots; SSR styles and direct reload; keyboard dialogs and focus. No real Stripe charges, email or cloud writes. Build separately from a running dev distDir.

References checked: https://ant.design/docs/react/use-with-next/ ; https://ant.design/docs/react/migration-v6/ ; https://ant.design/docs/react/compatible-style/ . Ant Design v6 supports React 19 without the v5 patch. Do not add Babel or replace the existing Next compiler.
