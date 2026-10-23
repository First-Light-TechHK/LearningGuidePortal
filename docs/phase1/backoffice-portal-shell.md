# BackOffice Portal shell and menu access

Source: `Learning_Guide_BackOffice_Portal_PRD_v1_1_EN_UK` (§3 roles, §6.5 navigation) and Figma
`Learning-Guide-YL` page "后台（Portal+Student+Reporting+HelpDesk）" frames 1017:2 (menu & role) and 778:620 (Settings).

## Access model (menu level)

- Six fixed roles: `admin`, `course_creator`, `graphic_designer`, `finance`, `operation_admin`, `operation_ai`
  (`lib/backofficeRbac.ts`, the PRD §3.2 matrix is kept verbatim including View / Edit / Full).
- Enforcement is menu level only: a menu whose cell is `None` is hidden and its pages return 404, its APIs 404.
  Today that is Knowledge and AI Tutor for Operation Admin. Settings -> Employee Account is Admin only.
- The role lives on the operator account (`ProductUser.backofficeRole`). Operators without a role are treated as
  Admin, which is the access they had before roles existed. Course authors (`teacher`) keep the Course menu only.
- The server decides the menus (`services/backofficeShell.ts`); the browser only renders them.
  Pages call `requireBackofficeMenu`; knowledge APIs are checked in `rejectIfUnauthenticated`.
- Assign a role until Employee Account exists: `npm run backoffice:role -- <operator-email> <role>`.

## Menus

| Menu | Route | State |
|---|---|---|
| Course | `/[locale]/backoffice/courses` | existing course editor; module follows the Course PRD |
| Knowledge, AI Tutor | `/[locale]/backoffice/knowledge`, `/ai-tutor` | access check, then redirect to `BACKOFFICE_KNOWLEDGE_URL` / `BACKOFFICE_AI_TUTOR_URL` (separately owned front end); default is the in-app Knowledge System pages |
| Order | `/[locale]/backoffice/orders` | existing order manager |
| Reporting, Student, HelpDesk | `/reporting`, `/students`, `/helpdesk` | placeholder until each module PRD |
| Settings | `/settings` -> first sub item | Employee Account (Admin, placeholder), Payment Gateway (`/payment`), Notification Configuration (placeholder), Portal Content (`/portal`) |

## Shell

Header (logo, title, EN / 中文 switch saved to the employee, avatar with email prefix and role, Change Password and
Sign Out), collapsible sidebar (icons with tooltips, remembered per browser), Settings second-level menu.
Menu icons are Remix Icon SVGs named in the Figma layers (`public/backoffice/icons`).

Pending visual sign-off (no Figma frame): collapsed sidebar, language menu, Change Password dialog, placeholder
pages, the extra "Portal Content" Settings item.

## Tests

- `tests/unit/backoffice-rbac.test.ts`, `tests/unit/backoffice-nav.test.ts`
- `tests/e2e/backoffice-shell.spec.ts` (local dev server, project `e2e-local-demo`)
