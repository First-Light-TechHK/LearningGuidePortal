import { isValidName, normaliseName } from "@/lib/nameValidation";
import { isBusinessEmail, normaliseEmail } from "@/lib/emailValidation";

export type ContactInput = { clientEventId: string; firstName: string; lastName: string; email: string; phone: string; subject: string; message: string; consent: true; locale: "en-GB" | "zh-CN" };
export type ContactRequest = ContactInput & { id: string; userId: string | null; payloadHash: string; createdAt: string; status: "new" };
export class ContactError extends Error {
  constructor(public code: "CONTACT_INVALID" | "CONTACT_CONFLICT" | "CONTACT_UNAVAILABLE", public status = 400) { super(code); }
}

export function parseContactInput(value: unknown): ContactInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ContactError("CONTACT_INVALID");
  const input = value as Record<string, unknown>;
  const text = (key: string) => typeof input[key] === "string" ? (input[key] as string).trim() : "";
  const firstName = normaliseName(text("firstName")), lastName = normaliseName(text("lastName")), email = normaliseEmail(text("email"));
  const clientEventId = text("clientEventId"), phone = text("phone"), subject = text("subject"), message = text("message");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientEventId)
    || !isValidName(firstName) || !isValidName(lastName) || email.length > 254 || !isBusinessEmail(email)
    || phone.length > 40 || !subject || subject.length > 200 || !message || message.length > 5000
    || input.consent !== true || !["en-GB", "zh-CN"].includes(String(input.locale))) throw new ContactError("CONTACT_INVALID");
  return { clientEventId: clientEventId.toLowerCase(), firstName, lastName, email, phone, subject, message, consent: true, locale: input.locale as ContactInput["locale"] };
}
