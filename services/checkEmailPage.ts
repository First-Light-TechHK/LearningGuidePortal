import { checkEmailView } from "@/lib/pendingCheckEmail";
import { hasCommittedPendingActivation } from "@/services/productStore";
import { emailVerificationRequired } from "@/services/runtimeConfig";

export async function checkEmailPageModel(email: string, copy: { sent: string; idle: string }) {
  const pendingUnusedLink = email.trim() ? await hasCommittedPendingActivation(email) : false;
  return checkEmailView({
    verificationRequired: emailVerificationRequired(),
    pendingUnusedLink,
    sentDescription: copy.sent,
    idleDescription: copy.idle,
  });
}
