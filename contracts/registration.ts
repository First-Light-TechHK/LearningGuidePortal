import type { Locale } from "@/lib/i18n/config";

export type RegistrationRequest = {
  email?: string;
  password?: string;
  nickname?: string;
  locale?: Locale;
  termsAccepted?: unknown;
};

export class RegistrationConsentError extends Error {
  readonly code = "REGISTRATION_CONSENT_REQUIRED";
  constructor() { super("Registration consent is required."); }
}
