/** check-email is a view of Pending: a committed unused verification link, and only while verification is required. */
export function checkEmailView(input: {
  verificationRequired: boolean;
  pendingUnusedLink: boolean;
  sentDescription: string;
  idleDescription: string;
}) {
  const claimsActivationSent = input.verificationRequired && input.pendingUnusedLink;
  return {
    claimsActivationSent,
    description: claimsActivationSent ? input.sentDescription : input.idleDescription,
  };
}

export function registrationContinueHref(input: { verificationRequired: boolean; locale: string; email: string; returnTo: string }) {
  if (!input.verificationRequired) return input.returnTo || `/${input.locale}/account/my-learning`;
  return `/${input.locale}/portal/check-email?email=${encodeURIComponent(input.email.trim().toLowerCase())}`;
}
