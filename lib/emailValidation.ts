const BUSINESS_EMAIL = /^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*@[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*(?:\.[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)*\.[A-Za-z]{2,}$/;

export function normaliseEmail(value: string) { return value.trim().toLowerCase(); }

export function isBusinessEmail(value: string) {
  const email = normaliseEmail(value);
  return BUSINESS_EMAIL.test(email);
}
