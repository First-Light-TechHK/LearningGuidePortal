import { randomBytes } from "crypto";
import { emailDeliveryConfigured, sendVerificationEmail } from "./emailService";
import {
  commitPendingUserWithToken,
  createSession,
  ensureProductData,
  issueEmailVerificationToken,
  publicUser,
  registerUserAttempt,
  verifyEmailToken,
  type ProductUser,
} from "./productStore";
import { NAME_INVALID_MESSAGE, validateName } from "@/lib/nameValidation";
import { appEnvironment, emailVerificationRequired } from "./runtimeConfig";

type Locale = "en-GB" | "zh-CN";

export type EmailRegistrationInput = {
  email?: unknown;
  password?: unknown;
  nickname?: unknown;
  locale?: unknown;
  role?: ProductUser["role"];
  verificationOrigin: () => string;
};

export type EmailRegistrationResult =
  | { kind: "invalid"; message: string }
  | { kind: "not_configured"; message: string }
  | { kind: "delivery_failed"; message: string }
  | { kind: "verification_required" }
  | { kind: "duplicate" }
  | { kind: "session"; user: ReturnType<typeof publicUser>; sessionToken: string };

function registrationFields(input: EmailRegistrationInput) {
  const email = (typeof input.email === "string" ? input.email : "").trim().toLowerCase();
  const password = typeof input.password === "string" ? input.password : "";
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Enter a valid email address.");
  if (password.length < 8) throw new Error("Password must contain at least 8 characters.");
  const rawName = typeof input.nickname === "string" ? input.nickname : "";
  if (!rawName.trim()) throw new Error(NAME_INVALID_MESSAGE);
  const nickname = validateName(rawName);
  const locale: Locale = input.locale === "zh-CN" ? "zh-CN" : "en-GB";
  return { email, password, nickname, locale };
}

async function emailAlreadyRegistered(email: string) {
  const data = await ensureProductData();
  return data.users.some((user) => user.email === email);
}

export async function registerEmailAccount(input: EmailRegistrationInput): Promise<EmailRegistrationResult> {
  if (emailVerificationRequired() && !emailDeliveryConfigured()) {
    return { kind: "not_configured", message: `Email verification is not configured for ${appEnvironment()}.` };
  }
  let fields: ReturnType<typeof registrationFields>;
  try {
    fields = registrationFields(input);
  } catch (error) {
    return { kind: "invalid", message: error instanceof Error ? error.message : "Registration failed." };
  }

  if (emailVerificationRequired()) {
    if (await emailAlreadyRegistered(fields.email)) return { kind: "verification_required" };
    const rawToken = randomBytes(32).toString("base64url");
    try {
      const origin = input.verificationOrigin().replace(/\/+$/, "");
      if (!/^https?:\/\//i.test(origin)) throw new Error("Email delivery failed.");
      await sendVerificationEmail({
        to: fields.email,
        url: `${origin}/${fields.locale}/portal/verify-email?token=${encodeURIComponent(rawToken)}`,
        locale: fields.locale,
      });
    } catch (error) {
      return { kind: "delivery_failed", message: error instanceof Error ? error.message : "Email delivery failed." };
    }
    await commitPendingUserWithToken({ ...fields, role: input.role, rawToken });
    return { kind: "verification_required" };
  }

  const { user, created } = await registerUserAttempt({ ...fields, role: input.role });
  if (!created) return { kind: "duplicate" };
  const verificationToken = await issueEmailVerificationToken(user.id, true);
  const activatedUser = await verifyEmailToken(verificationToken);
  const session = await createSession(user.id);
  return { kind: "session", user: publicUser(activatedUser), sessionToken: session.token };
}

export function emailRegistrationHttp(result: EmailRegistrationResult, requestId: string) {
  if (result.kind === "invalid") {
    return { status: 400, body: { ok: false, code: "REGISTRATION_FAILED", message: result.message, requestId } };
  }
  if (result.kind === "not_configured") {
    return { status: 503, body: { ok: false, code: "EMAIL_DELIVERY_NOT_CONFIGURED", message: result.message, requestId } };
  }
  if (result.kind === "delivery_failed") {
    return { status: 503, body: { ok: false, code: "EMAIL_DELIVERY_FAILED", message: result.message, requestId } };
  }
  if (result.kind === "session") {
    return {
      status: 200,
      body: { ok: true, data: { user: result.user, verificationRequired: false }, requestId },
      sessionToken: result.sessionToken,
    };
  }
  if (result.kind === "duplicate") {
    return { status: 200, body: { ok: true, data: { verificationRequired: false }, requestId } };
  }
  return { status: 200, body: { ok: true, data: { verificationRequired: true }, requestId } };
}
