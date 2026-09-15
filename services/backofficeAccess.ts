import type { ProductCourse, ProductUser } from "./productStore";

type AccessUser = Pick<ProductUser, "id" | "role" | "status" | "email" | "emailVerifiedAt">;

export function canOperateBackoffice(user: AccessUser | null | undefined): boolean {
  if (!user || user.status !== "active") return false;
  const configured = process.env.BACKOFFICE_OPERATOR_EMAIL?.trim().toLowerCase();
  return user.role === "operator" || Boolean(user.emailVerifiedAt && configured && user.email?.toLowerCase() === configured);
}

export function canAuthorCourses(user: AccessUser | null | undefined): boolean {
  return Boolean(user && user.status === "active" && (user.role === "teacher" || canOperateBackoffice(user)));
}

export const canAccessBackoffice = canAuthorCourses;

export function canManageCourse(user: AccessUser | null | undefined, course: Pick<ProductCourse, "authorIds"> | null | undefined): boolean {
  return Boolean(course && canAuthorCourses(user) && (canOperateBackoffice(user) || course.authorIds?.includes(user!.id)));
}
