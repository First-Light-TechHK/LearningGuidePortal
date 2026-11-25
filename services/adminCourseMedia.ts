import { adminCatalogueConfig } from "./adminCatalogue";
import { checkEntitlement, publicFirstLesson, readProductData, type ProductCourse, type ProductLesson, type ProductUser } from "./productStore";

/**
 * Server-side proxy for Admin-projected course media.
 *
 * Browsers cannot send the `X-API-Key` Admin requires, so a mirrored course's cover and
 * lesson assets point at `/api/admin-course-media/{adminCourseId}/...` on Portal's own
 * origin. This module resolves that to Admin's `/api/portal/v1/media/**`, applies the
 * same access policy as local media (`services/courseMedia.ts`), and streams the bytes.
 */

export type AdminMediaKind = "cover" | "asset";

export class AdminMediaError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "AdminMediaError";
  }
}

function mediaAssetId(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const marker = "/assets/";
  const index = url.indexOf(marker);
  if (index < 0) return null;
  const assetId = url.slice(index + marker.length).split(/[?#]/)[0];
  return assetId || null;
}

function lessonReferencesAsset(lesson: ProductLesson, assetId: string) {
  return (lesson.contents || []).some(content =>
    mediaAssetId(content.url) === assetId
    || (content.nodes || []).some(node => mediaAssetId(node.url) === assetId));
}

function courseReferencesAsset(course: ProductCourse, assetId: string) {
  return course.sections.some(section => section.lessons.some(lesson => lessonReferencesAsset(lesson, assetId)));
}

async function findMirroredCourse(adminCourseId: string) {
  const data = await readProductData();
  return data.courses.find(course => course.origin === "admin"
    && course.adminCourseId === adminCourseId
    && course.status === "published") || null;
}

function upstreamPath(kind: AdminMediaKind, adminCourseId: string, assetId?: string) {
  const course = encodeURIComponent(adminCourseId);
  return kind === "cover"
    ? `/api/portal/v1/media/${course}/cover`
    : `/api/portal/v1/media/${course}/assets/${encodeURIComponent(assetId || "")}`;
}

export async function proxyAdminCourseMedia(
  request: Request,
  user: ProductUser | null,
  kind: AdminMediaKind,
  adminCourseId: string,
  assetId?: string,
): Promise<Response> {
  const config = adminCatalogueConfig();
  if (config.mode !== "admin") throw new AdminMediaError("Media not found.", 404);

  const course = await findMirroredCourse(adminCourseId);
  if (!course) throw new AdminMediaError("Media not found.", 404);

  if (kind === "asset") {
    if (!assetId || !courseReferencesAsset(course, assetId)) throw new AdminMediaError("Media not found.", 404);
    const preview = publicFirstLesson(course);
    const previewable = preview ? lessonReferencesAsset(preview, assetId) : false;
    const entitled = user ? (await checkEntitlement(user.id, course.id)).allowed : false;
    if (!previewable && !entitled) throw new AdminMediaError("This media requires course access.", 403);
  }

  const baseUrl = process.env.ADMIN_PORTAL_BASE_URL?.trim().replace(/\/+$/, "") || "";
  const token = process.env.ADMIN_PORTAL_API_TOKEN?.trim() || "";
  const headers: Record<string, string> = { "X-API-Key": token };
  const range = request.headers.get("range");
  if (range) headers.Range = range;

  let upstream: Response;
  try {
    upstream = await fetch(`${baseUrl}${upstreamPath(kind, adminCourseId, assetId)}`, {
      method: request.method === "HEAD" ? "HEAD" : "GET",
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch {
    throw new AdminMediaError("Course media is temporarily unavailable.", 502);
  }

  if (upstream.status === 404) throw new AdminMediaError("Media not found.", 404);
  if (upstream.status === 401 || upstream.status === 403) throw new AdminMediaError("Course media is not authorised.", 502);
  if (!upstream.ok && upstream.status !== 416) throw new AdminMediaError("Course media is temporarily unavailable.", 502);

  const responseHeaders = new Headers();
  for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  responseHeaders.set("Cache-Control", "private, no-store");
  responseHeaders.set("Vary", "Cookie");
  responseHeaders.set("X-Content-Type-Options", "nosniff");
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export function adminMediaErrorResponse(error: unknown): Response {
  const status = error instanceof AdminMediaError ? error.status : 500;
  return new Response(null, { status, headers: { "Cache-Control": status === 500 ? "no-store" : "private, no-store" } });
}
