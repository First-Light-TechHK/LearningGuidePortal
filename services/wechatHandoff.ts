import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { WeChatProfile } from "@/contracts/wechat";
import { appEnvironment, publicAppOrigin, safeReturnTo } from "./runtimeConfig";
import { consumeWechatTicket, insertWechatTicket } from "@/repositories/wechatTicketRepository";

export type WeChatEnvironment = "DEV" | "SIT" | "UAT";
export const WECHAT_HANDOFF_COOKIE = "learning_guide_wechat_handoff";
const MAX_AGE_MS = 2 * 60 * 1000;

function configuredOrigin(name: string) {
  const raw = process.env[name]?.trim();
  if (!raw) throw new Error(`${name} is required`);
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) throw new Error(`${name} must be an HTTPS origin`);
  return url.origin;
}

export function wechatHandoffEnabled() { return Boolean(process.env.WECHAT_AUTH_ORIGIN?.trim()); }
export function wechatAuthOrigin() { return configuredOrigin("WECHAT_AUTH_ORIGIN"); }
export function wechatEnvironment(): WeChatEnvironment {
  const env = appEnvironment();
  if (env !== "DEV" && env !== "SIT" && env !== "UAT") throw new Error("Unsupported WeChat environment");
  return env;
}
export function wechatOriginForEnvironment(env: WeChatEnvironment) {
  return configuredOrigin(`WECHAT_${env}_ORIGIN`);
}
export function isWechatAuthHost(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host")?.split(",")[0].trim() || request.headers.get("host") || url.host;
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() || url.protocol.slice(0, -1);
  return publicAppOrigin(request) === wechatAuthOrigin() && `${proto}://${host}` === wechatAuthOrigin();
}

function signingKey() {
  const value = process.env.SESSION_SECRET?.trim();
  if (!value || value.length < 32) throw new Error("SESSION_SECRET is required");
  return value;
}
function signature(payload: string) { return createHmac("sha256", signingKey()).update(payload).digest("base64url"); }
function sharedSignature(payload: string) {
  const secret = process.env.WECHAT_SHARED_STATE_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("WECHAT_SHARED_STATE_SECRET is required");
  return createHmac("sha256", secret).update(payload).digest("base64url");
}
function encode(value: object) {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${signature(payload)}`;
}
function decode(value: string | undefined): Record<string, unknown> | null {
  if (!value) return null;
  const [payload, mac, extra] = value.split(".");
  if (!payload || !mac || extra) return null;
  const expected = Buffer.from(signature(payload));
  const actual = Buffer.from(mac);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try { return JSON.parse(Buffer.from(payload, "base64url").toString()) as Record<string, unknown>; } catch { return null; }
}
export function makeHandoffCookie(returnTo: string) {
  const nonce = randomBytes(32).toString("base64url");
  return { nonce, value: encode({ nonce, returnTo, expiresAt: Date.now() + 10 * 60_000 }) };
}
export function readHandoffCookie(value: string | undefined) {
  const data = decode(value);
  if (!data || typeof data.nonce !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(data.nonce)
      || typeof data.returnTo !== "string" || typeof data.expiresAt !== "number" || data.expiresAt <= Date.now()) return null;
  return { nonce: data.nonce, returnTo: safeReturnTo(data.returnTo, "/en-GB/account/my-learning") };
}
export function makeCentralRequest(env: WeChatEnvironment, nonce: string, returnTo: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(nonce)) throw new Error("Invalid nonce");
  const payload = Buffer.from(JSON.stringify({ env, nonce, returnTo, expiresAt: Date.now() + 10 * 60_000 })).toString("base64url");
  return `${payload}.${sharedSignature(payload)}`;
}
export function readCentralRequest(value: string | null) {
  const [payload, mac, extra] = (value || "").split(".");
  if (!payload || !mac || extra) return null;
  const expected = Buffer.from(sharedSignature(payload));
  const actual = Buffer.from(mac);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  let data: Record<string, unknown>;
  try { data = JSON.parse(Buffer.from(payload, "base64url").toString()) as Record<string, unknown>; } catch { return null; }
  if (!data || !["DEV", "SIT", "UAT"].includes(String(data.env))
      || typeof data.nonce !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(data.nonce)
      || typeof data.returnTo !== "string" || typeof data.expiresAt !== "number" || data.expiresAt <= Date.now()) return null;
  return { env: data.env as WeChatEnvironment, nonce: data.nonce, returnTo: safeReturnTo(data.returnTo, "/en-GB/account/my-learning") };
}
function ticketHash(ticket: string) { return createHash("sha256").update(ticket).digest("hex"); }
export async function issueWechatTicket(input: { env: WeChatEnvironment; nonce: string; profile: WeChatProfile }) {
  const ticket = randomBytes(32).toString("base64url");
  await insertWechatTicket({ hash: ticketHash(ticket), ...input });
  return ticket;
}
export async function redeemWechatTicket(ticket: string, env: WeChatEnvironment) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) return null;
  return consumeWechatTicket(ticketHash(ticket), env);
}
export function handoffSecret(env: WeChatEnvironment) {
  const value = process.env[`WECHAT_${env}_HANDOFF_SECRET`]?.trim();
  if (!value || value.length < 32) throw new Error("WeChat handoff secret is required");
  return value;
}
export function verifyHandoffSecret(env: WeChatEnvironment, supplied: string | null) {
  const expected = Buffer.from(handoffSecret(env));
  const actual = Buffer.from(supplied || "");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
