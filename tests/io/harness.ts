import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export const SESSION_COOKIE = "learning_guide_session";
export const PASSWORD = "Passw0rd!123";
export const PLAN_ID = "everything-pc-6";
export const COURSE_PLAN = "epicureanism-pc-6";
export const CATEGORY_PLAN = "european-humanities-pc-6";
export const COURSE_ID = "epicureanism";
export const SERVER_AMOUNT_MINOR = 9900;
export const COURSE_AMOUNT_MINOR = 4900;
export const TRIAL_MS = 3 * 24 * 60 * 60 * 1000;

type CookieJar = Map<string, string>;

function cookieJar(): CookieJar {
  const globalState = globalThis as typeof globalThis & { __lgIoCookies?: CookieJar };
  if (!globalState.__lgIoCookies) globalState.__lgIoCookies = new Map();
  return globalState.__lgIoCookies;
}

export function clearCookies() {
  cookieJar().clear();
}

export function setCookie(name: string, value: string) {
  cookieJar().set(name, value);
}

export function getCookie(name: string) {
  return cookieJar().get(name);
}

export function takeSetCookie(response: Response) {
  const listed = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const fallback = response.headers.get("set-cookie");
  const headers = listed.length > 0 ? listed : fallback ? [fallback] : [];
  for (const header of headers) {
    const [pair] = header.split(";");
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (/max-age=0/i.test(header) || value === "" || value === '""') cookieJar().delete(name);
    else cookieJar().set(name, decodeURIComponent(value));
  }
}

export function jsonRequest(method: string, url: string, body?: unknown, extraHeaders?: Record<string, string>) {
  const headers: Record<string, string> = { ...extraHeaders };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookieJar().size > 0) {
    headers.cookie = [...cookieJar().entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }
  return new Request(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

export function publicShape(body: Record<string, unknown>) {
  const copy = { ...body };
  delete copy.requestId;
  return copy;
}

export async function isolate(prefix: string) {
  const originalCwd = process.cwd();
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  const envSnapshot = { ...process.env };
  process.chdir(directory);
  Object.assign(process.env, {
    APP_ENV: "DEV",
    STORAGE_BACKEND: "local",
    EMAIL_VERIFICATION_REQUIRED: "0",
    EMAIL_DELIVERY: "",
    PAYMENT_MODE: "demo",
    LOCAL_SOCIAL_LOGIN: "0",
    SESSION_SECRET: "test-session-secret-with-at-least-32-characters"
  });
  delete process.env.DATABASE_URL;
  delete process.env.SES_FROM_EMAIL;
  delete process.env.SMTP_HOST;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.BACKOFFICE_OPERATOR_EMAIL;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  clearCookies();
  return {
    async restore() {
      process.chdir(originalCwd);
      for (const key of Object.keys(process.env)) {
        if (!(key in envSnapshot)) delete process.env[key];
      }
      Object.assign(process.env, envSnapshot);
      clearCookies();
      await rm(directory, { recursive: true, force: true });
    }
  };
}

export function uniqueEmail(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
}
