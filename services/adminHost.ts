export const DEFAULT_ADMIN_HOSTS = ["admin.ilovelearningguide.com", "admin.sit.ilovelearningguide.com"];

export function adminHosts() {
  const configured = (process.env.ADMIN_HOSTS || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (configured.length) return configured;
  const hosts = [...DEFAULT_ADMIN_HOSTS];
  if ((process.env.APP_ENV || "DEV").trim().toUpperCase() === "DEV") hosts.push("localhost", "127.0.0.1");
  return hosts;
}

export function requestHostname(request: Request) {
  const raw = request.headers.get("x-forwarded-host")?.split(",")[0].trim() || request.headers.get("host") || "";
  return raw.split(":")[0].toLowerCase();
}

export function isAdminHost(request: Request) {
  return adminHosts().includes(requestHostname(request));
}

export function isBackofficePath(pathname: string) {
  return /^\/(?:[a-z]{2}-[A-Z]{2}\/)?backoffice(?:\/|$)/.test(pathname)
    || pathname.startsWith("/api/backoffice")
    || pathname.startsWith("/api/auth/admin");
}

function isAdminAllowedPath(pathname: string) {
  if (isBackofficePath(pathname)) return true;
  if (pathname.startsWith("/api/auth/logout")) return true;
  if (pathname.startsWith("/api/auth/verify-email")) return true;
  if (pathname.startsWith("/api/health")) return true;
  if (/^\/(?:en-GB|zh-CN)\/portal\/verify-email(?:\/|$)/.test(pathname)) return true;
  if (pathname.startsWith("/_next")) return true;
  if (pathname.startsWith("/api/portal-media/")) return true;
  if (/\.[a-z0-9]+$/i.test(pathname)) return true;
  return false;
}

export function adminHostDecision(request: Request): { allow?: true; status?: number; location?: string } {
  const { pathname } = new URL(request.url);
  if (pathname.startsWith("/_next") || pathname.startsWith("/api/health") || /\.[a-z0-9]+$/i.test(pathname)) return { allow: true };
  if (!isAdminHost(request)) {
    if (isBackofficePath(pathname)) return { status: 404 };
    return { allow: true };
  }
  if (isAdminAllowedPath(pathname)) return { allow: true };
  const locale = pathname.match(/^\/(en-GB|zh-CN)(?:\/|$)/)?.[1] || "en-GB";
  return { status: 307, location: `/${locale}/backoffice` };
}
