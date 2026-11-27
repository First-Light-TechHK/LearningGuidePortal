import { adminCatalogueConfig, type AdminCatalogueConfig } from "./adminCatalogue";
import { refreshCourseIfStale, syncCatalogueIfStale } from "./adminCourseMirror";

/**
 * The single switch for where Portal course reads come from.
 *
 * `store` (default everywhere, including every existing test) keeps today's behaviour:
 * courses come from the local product aggregate. `admin` turns on the read-only Admin
 * projection mirror and is only configured on the Sandbox deployment. The switch is a
 * configuration value, never an environment branch in product code.
 */

export type CourseSourceMode = "admin" | "store";

export function courseSourceConfig(): AdminCatalogueConfig {
  return adminCatalogueConfig();
}

export function courseSourceMode(): CourseSourceMode {
  return adminCatalogueConfig().mode;
}

/** Read-only diagnostics for health/ops; never gates readiness. */
export function courseSourceDiagnostics(): { courseSource: CourseSourceMode; adminCatalogue: "configured" | "missing" } {
  const config = adminCatalogueConfig();
  return { courseSource: config.mode, adminCatalogue: config.configured ? "configured" : "missing" };
}

/** Best-effort catalogue refresh; no-op unless the admin source is active. */
export async function syncCourseSource(): Promise<void> {
  if (courseSourceMode() !== "admin") return;
  await syncCatalogueIfStale();
}

/** Best-effort detail refresh for one course; no-op unless the admin source is active. */
export async function refreshCourseSource(slugOrId: string): Promise<void> {
  if (courseSourceMode() !== "admin") return;
  await refreshCourseIfStale(slugOrId);
}
