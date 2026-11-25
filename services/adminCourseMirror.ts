import { AdminCatalogueError, adminCatalogueEnabled, getCourse, listCourses } from "./adminCatalogue";
import { toProductCourseDetail, toProductCourseSummary } from "@/lib/adminCourseAdapter";
import { editProductData, readProductData, type ProductCourse } from "./productStore";

/**
 * Mirrors Admin's online courses into the local product aggregate as read-only rows
 * (`origin: "admin"`). Portal's existing readers (course pages, entitlements, bookmarks,
 * learning overview) already read `data.courses`, so a mirror keeps them unchanged while
 * Admin stays the single writer.
 *
 * Failure policy: on any Admin error the previous mirror is kept; a page is never
 * taken down because Admin is unreachable. Courses that disappear from the projection
 * are archived (not deleted) so saved study records keep a valid course id.
 */

const DEFAULT_TTL_SECONDS = 60;
let lastCatalogueSyncAt = 0;
let catalogueInFlight: Promise<void> | null = null;
const detailInFlight = new Map<string, Promise<void>>();

function ttlMs() {
  const seconds = Number(process.env.ADMIN_PORTAL_CACHE_TTL_SECONDS);
  const effective = Number.isFinite(seconds) && seconds >= 0 ? seconds : DEFAULT_TTL_SECONDS;
  return effective * 1000;
}

function isFresh(at: number | undefined) {
  return typeof at === "number" && at > 0 && Date.now() - at < ttlMs();
}

function log(event: string, detail: Record<string, unknown> = {}) {
  console.warn(JSON.stringify({ type: "admin-course-mirror", event, ...detail }));
}

function errorKind(error: unknown) {
  return error instanceof AdminCatalogueError ? error.kind : "unknown";
}

/** Test seam: forget TTL/in-flight state between cases. */
export function resetAdminCourseMirrorForTests() {
  lastCatalogueSyncAt = 0;
  catalogueInFlight = null;
  detailInFlight.clear();
}

/**
 * Refresh the catalogue mirror at most once per TTL. Concurrent callers share one
 * request. Never throws: a degraded Admin is logged and the previous mirror survives.
 */
export async function syncCatalogueIfStale(force = false): Promise<void> {
  if (!adminCatalogueEnabled()) return;
  if (!force && isFresh(lastCatalogueSyncAt)) return;
  if (catalogueInFlight) return catalogueInFlight;

  catalogueInFlight = (async () => {
    try {
      const summaries = await listCourses();
      const nowIso = new Date().toISOString();
      await editProductData(data => {
        const seen = new Set<string>();
        for (const summary of summaries) {
          const adminCourseId = summary.id;
          if (!adminCourseId) continue;
          seen.add(adminCourseId);
          const existing = data.courses.find(course => course.origin === "admin" && course.adminCourseId === adminCourseId);
          const mapped = toProductCourseSummary(summary, nowIso, existing);
          if (existing) {
            const index = data.courses.indexOf(existing);
            // Keep the last detail payload until the detail refresh replaces it.
            data.courses[index] = { ...existing, ...mapped, sections: existing.sections, adminDetailSyncedAt: existing.adminDetailSyncedAt };
          } else {
            data.courses.push(mapped);
          }
        }
        for (const course of data.courses) {
          if (course.origin !== "admin" || !course.adminCourseId) continue;
          if (!seen.has(course.adminCourseId) && course.status !== "archived") {
            course.status = "archived";
            course.archivedAt = nowIso;
            course.updatedAt = nowIso;
          }
        }
      });
      lastCatalogueSyncAt = Date.now();
    } catch (error) {
      log("degraded", { kind: errorKind(error) });
    } finally {
      catalogueInFlight = null;
    }
  })();
  return catalogueInFlight;
}

/**
 * Refresh one mirrored course's detail at most once per TTL. Returns quietly when the
 * slug is not an Admin-mirrored course, so local store courses are untouched.
 */
export async function refreshCourseIfStale(slugOrId: string, force = false): Promise<void> {
  if (!adminCatalogueEnabled()) return;
  await syncCatalogueIfStale();

  const data = await readProductData();
  const course = data.courses.find(item => item.origin === "admin"
    && (item.slug === slugOrId || item.id === slugOrId || item.adminCourseId === slugOrId));
  if (!course || !course.adminCourseId) return;
  const adminCourseId = course.adminCourseId;
  const detailSyncedAt = course.adminDetailSyncedAt ? Date.parse(course.adminDetailSyncedAt) : 0;
  if (!force && isFresh(detailSyncedAt)) return;
  const inFlight = detailInFlight.get(adminCourseId);
  if (inFlight) return inFlight;

  const task = (async () => {
    try {
      const detail = await getCourse(adminCourseId);
      const nowIso = new Date().toISOString();
      await editProductData(aggregate => {
        const row = aggregate.courses.find(item => item.origin === "admin" && item.adminCourseId === adminCourseId);
        if (!row) return;
        const mapped = toProductCourseDetail(detail, nowIso, row);
        Object.assign(row, mapped, { adminDetailSyncedAt: nowIso });
      });
    } catch (error) {
      log("detail-degraded", { kind: errorKind(error) });
    } finally {
      detailInFlight.delete(adminCourseId);
    }
  })();
  detailInFlight.set(adminCourseId, task);
  return task;
}

/** True when the row is a read-only Admin mirror that authoring must not modify. */
export function isAdminMirroredCourse(course: Pick<ProductCourse, "origin">) {
  return course.origin === "admin";
}
