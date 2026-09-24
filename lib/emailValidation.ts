const BUSINESS_EMAIL = /^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*@[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*(?:\.[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)*\.[A-Za-z]{2,}$/;

export const MAX_EMAIL_LENGTH = 254;

export function normaliseEmail(value: string) { return value.trim().toLowerCase(); }

export function isEmailTooLong(value: string) { return normaliseEmail(value).length > MAX_EMAIL_LENGTH; }

export function isBusinessEmail(value: string) {
  const email = normaliseEmail(value);
  return email.length <= MAX_EMAIL_LENGTH && BUSINESS_EMAIL.test(email);
}
