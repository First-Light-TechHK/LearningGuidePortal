import { BACKOFFICE_MENUS, canAccessMenu, canManageEmployees, isBackofficeRole, visibleMenus, type BackofficeMenu, type BackofficeRole } from "@/lib/backofficeRbac";
import type { ProductCourse, ProductUser } from "./productStore";

type AccessUser = Pick<ProductUser, "id" | "role" | "status" | "email" | "emailVerifiedAt"> & { backofficeRole?: unknown };

export function canOperateBackoffice(user: AccessUser | null | undefined): boolean {
  return Boolean(user && user.status === "active" && user.role === "operator");
}

export function canAuthorCourses(user: AccessUser | null | undefined): boolean {
  return Boolean(user && user.status === "active" && (user.role === "teacher" || canOperateBackoffice(user)));
}

export const canAccessBackoffice = canAuthorCourses;

export function canManageCourse(user: AccessUser | null | undefined, course: Pick<ProductCourse, "authorIds"> | null | undefined): boolean {
  return Boolean(course && canAuthorCourses(user) && (canOperateBackoffice(user) || course.authorIds?.includes(user!.id)));
}

/**
 * The employee role of a BackOffice operator. Operators created before roles
 * existed keep the full access they had, so a missing role reads as Admin.
 * Course authors (teacher) are not employees and have no role.
 */
export function backofficeRoleOf(user: AccessUser | null | undefined): BackofficeRole | null {
  if (!canOperateBackoffice(user)) return null;
  return isBackofficeRole(user!.backofficeRole) ? user!.backofficeRole : "admin";
}

/** Menus the user may open, in sidebar order. Course authors keep Course only. */
export function backofficeMenusFor(user: AccessUser | null | undefined): BackofficeMenu[] {
  const role = backofficeRoleOf(user);
  if (role) return visibleMenus(role);
  return canAuthorCourses(user) ? ["course"] : [];
}

export function canUseBackofficeMenu(user: AccessUser | null | undefined, menu: BackofficeMenu): boolean {
  const role = backofficeRoleOf(user);
  if (role) return canAccessMenu(role, menu);
  return menu === "course" && canAuthorCourses(user);
}

export function canManageBackofficeEmployees(user: AccessUser | null | undefined): boolean {
  return canManageEmployees(backofficeRoleOf(user));
}

export { BACKOFFICE_MENUS };
