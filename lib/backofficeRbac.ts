// BackOffice Portal PRD v1.1 §3: six fixed employee roles and the menu matrix.
// Access is enforced at menu level: a role either reaches a menu (and every
// route/API behind it) or the menu is hidden and its URLs/APIs are refused.
// The View / Edit / Full levels are kept as data so business modules can
// adopt action-level checks later without changing the matrix.

export const BACKOFFICE_ROLES = ["admin", "course_creator", "graphic_designer", "finance", "operation_admin", "operation_ai"] as const;
export type BackofficeRole = (typeof BACKOFFICE_ROLES)[number];

// PORT-NAV-002: fixed sidebar order.
export const BACKOFFICE_MENUS = ["course", "knowledge", "aiTutor", "order", "reporting", "student", "helpdesk", "settings"] as const;
export type BackofficeMenu = (typeof BACKOFFICE_MENUS)[number];

export type BackofficePermission = "full" | "edit" | "view" | "none";

const ALL_VIEW: Record<BackofficeMenu, BackofficePermission> = {
  course: "view", knowledge: "view", aiTutor: "view", order: "view", reporting: "view", student: "view", helpdesk: "view", settings: "view"
};

// PRD §3.2 Role Permission Matrix, transcribed per role.
export const BACKOFFICE_PERMISSION_MATRIX: Record<BackofficeRole, Record<BackofficeMenu, BackofficePermission>> = {
  admin: { course: "full", knowledge: "full", aiTutor: "full", order: "full", reporting: "full", student: "full", helpdesk: "full", settings: "full" },
  course_creator: { ...ALL_VIEW },
  graphic_designer: { ...ALL_VIEW, course: "edit" },
  finance: { ...ALL_VIEW, order: "full", reporting: "full" },
  operation_admin: { course: "full", knowledge: "none", aiTutor: "none", order: "full", reporting: "full", student: "full", helpdesk: "full", settings: "full" },
  operation_ai: { ...ALL_VIEW, knowledge: "full", aiTutor: "full" }
};

export function isBackofficeRole(value: unknown): value is BackofficeRole {
  return typeof value === "string" && (BACKOFFICE_ROLES as readonly string[]).includes(value);
}

export function canAccessMenu(role: BackofficeRole, menu: BackofficeMenu): boolean {
  return BACKOFFICE_PERMISSION_MATRIX[role][menu] !== "none";
}

export function visibleMenus(role: BackofficeRole): BackofficeMenu[] {
  return BACKOFFICE_MENUS.filter((menu) => canAccessMenu(role, menu));
}

// PRD §3.3: Settings -> Employee Account is Admin-only, whatever the Settings level.
export function canManageEmployees(role: BackofficeRole | null): boolean {
  return role === "admin";
}

const KNOWLEDGE_AI_TUTOR_PATH = /^\/(?:api\/)?(?:chat-testing|dialogue-testing|dialogue)(?:\/|$)|^\/knowledge\/[^/]+\/[^/]+\/(?:chat-testing|dialogue-testing|dialogue)(?:\/|$)/;

/** Which menu owns a request path; null for shared paths (sign-in, assets, health). */
export function menuForBackofficePath(pathname: string): BackofficeMenu | null {
  const path = pathname.replace(/^\/(?:en-GB|zh-CN)(?=\/)/, "");
  const section = path.match(/^\/(?:api\/)?backoffice\/([^/?#]+)/)?.[1];
  if (section) {
    if (section === "courses") return "course";
    if (section === "knowledge") return "knowledge";
    if (section === "ai-tutor") return "aiTutor";
    if (section === "orders") return "order";
    if (section === "reporting") return "reporting";
    if (section === "students") return "student";
    if (section === "helpdesk") return "helpdesk";
    if (["settings", "payment", "portal"].includes(section)) return "settings";
    return null;
  }
  if (KNOWLEDGE_AI_TUTOR_PATH.test(path)) return "aiTutor";
  if (/^\/(?:knowledge|course|knowledge-wiki|source-materials|llm-draft|publish)(?:\/|$)/.test(path)) return "knowledge";
  if (/^\/api\/(?:navigation|courses|source-materials|draft|llm-draft|knowledge-draft|extract-material|releases|wiki)(?:\/|$)/.test(path)) return "knowledge";
  return null;
}
