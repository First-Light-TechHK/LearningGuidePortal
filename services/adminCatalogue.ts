import type { AdminCourseDetail, AdminCourseSummary, AdminProjectionEnvelope } from "@/contracts/admin-portal-catalogue";

/**
 * Read-only client for the Admin Portal projection (`/api/portal/v1/**`).
 *
 * This is the only place Portal talks to Admin about courses. It never logs the
 * service token and never throws the raw upstream body. Failures are classified
 * so the caller can degrade instead of crashing a page (see `services/courseSource.ts`).
 */

export type AdminCatalogueErrorKind =
  | "disabled"
  | "unauthorized"
  | "timeout"
  | "network"
  | "http"
  | "invalid";

export class AdminCatalogueError extends Error {
  constructor(
    message: string,
    readonly kind: AdminCatalogueErrorKind,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AdminCatalogueError";
  }
}

export type AdminCatalogueConfig = {
  /** `admin` only when the switch is on and both address and token are present. */
  mode: "admin" | "store";
  configured: boolean;
  baseUrlConfigured: boolean;
  tokenConfigured: boolean;
  timeoutMs: number;
};

const DEFAULT_TIMEOUT_MS = 5_000;
// A 401/403 means the token is wrong or has been rotated. Retrying on every page
// would turn one bad config into an upstream request storm, so keep a short cooldown.
const UNAUTHORIZED_COOLDOWN_MS = 30_000;
const LIST_LIMIT = 200;

let cooldownUntil = 0;

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function adminCatalogueConfig(): AdminCatalogueConfig {
  const baseUrl = process.env.ADMIN_PORTAL_BASE_URL?.trim();
  const token = process.env.ADMIN_PORTAL_API_TOKEN?.trim();
  const requested = (process.env.PORTAL_COURSE_SOURCE || "store").trim().toLowerCase() === "admin";
  const configured = Boolean(baseUrl && token);
  return {
    mode: requested && configured ? "admin" : "store",
    configured,
    baseUrlConfigured: Boolean(baseUrl),
    tokenConfigured: Boolean(token),
    timeoutMs: positiveNumber(process.env.ADMIN_PORTAL_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  };
}

/** True only when the admin projection is switched on AND fully configured. */
export function adminCatalogueEnabled() {
  return adminCatalogueConfig().mode === "admin";
}

/** Test seam: clears the authentication cooldown between cases. */
export function resetAdminCatalogueForTests() {
  cooldownUntil = 0;
}

function logDegraded(kind: AdminCatalogueErrorKind, status?: number) {
  // Deliberately excludes the token, headers and URL: only the failure class.
  console.warn(JSON.stringify({ type: "admin-catalogue", event: "degraded", kind, ...(status ? { status } : {}) }));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function request(path: string): Promise<unknown> {
  const config = adminCatalogueConfig();
  if (config.mode !== "admin") throw new AdminCatalogueError("Admin catalogue is not configured.", "disabled");
  if (Date.now() < cooldownUntil) {
    throw new AdminCatalogueError("Admin catalogue is cooling down after an authentication error.", "unauthorized", 401);
  }
  const baseUrl = process.env.ADMIN_PORTAL_BASE_URL?.trim().replace(/\/+$/, "") || "";
  const token = process.env.ADMIN_PORTAL_API_TOKEN?.trim() || "";

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      headers: { Accept: "application/json", "X-API-Key": token },
      cache: "no-store",
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    const kind: AdminCatalogueErrorKind = name === "AbortError" || name === "TimeoutError" ? "timeout" : "network";
    logDegraded(kind);
    throw new AdminCatalogueError(
      kind === "timeout" ? "Admin catalogue request timed out." : "Admin catalogue is unreachable.",
      kind,
    );
  }

  if (!response.ok) {
    const kind: AdminCatalogueErrorKind = response.status === 401 || response.status === 403 ? "unauthorized" : "http";
    if (kind === "unauthorized") cooldownUntil = Date.now() + UNAUTHORIZED_COOLDOWN_MS;
    logDegraded(kind, response.status);
    throw new AdminCatalogueError(`Admin catalogue returned HTTP ${response.status}.`, kind, response.status);
  }

  let body: AdminProjectionEnvelope<unknown>;
  try {
    body = (await response.json()) as AdminProjectionEnvelope<unknown>;
  } catch {
    logDegraded("invalid");
    throw new AdminCatalogueError("Admin catalogue returned invalid JSON.", "invalid");
  }
  if (!isObject(body) || body.success !== true) {
    logDegraded("invalid");
    throw new AdminCatalogueError("Admin catalogue returned an unsuccessful envelope.", "invalid");
  }
  return body.data;
}

/** Online, published, non-archived courses (the projection filters those upstream). */
export async function listCourses(): Promise<AdminCourseSummary[]> {
  const data = await request(`/api/portal/v1/courses?limit=${LIST_LIMIT}`);
  if (!Array.isArray(data)) throw new AdminCatalogueError("Admin catalogue list is not an array.", "invalid");
  return data.filter((item): item is AdminCourseSummary =>
    isObject(item) && typeof item.id === "string" && item.id.length > 0) as AdminCourseSummary[];
}

export async function getCourse(id: string): Promise<AdminCourseDetail> {
  if (!id) throw new AdminCatalogueError("A course id is required.", "invalid");
  const data = await request(`/api/portal/v1/courses/${encodeURIComponent(id)}`);
  if (!isObject(data) || typeof data.id !== "string") {
    throw new AdminCatalogueError("Admin catalogue course is malformed.", "invalid");
  }
  return data as AdminCourseDetail;
}
