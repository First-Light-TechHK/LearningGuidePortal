import { RegistrationConsentError } from "@/contracts/registration";

export function assertRegistrationConsent(value: unknown): asserts value is true {
  if (value !== true) throw new RegistrationConsentError();
}
