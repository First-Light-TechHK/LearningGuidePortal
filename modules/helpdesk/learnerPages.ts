// Server-side helpers shared by the learner Helpdesk pages
// (app/[locale]/account/my-learning/support/**). Same identity mapping as the
// learner Route Handlers (modules/helpdesk/http.ts requireLearner).
import { parseOrderIdParam } from "@/contracts/helpdesk";
import type { LearnerIdentity } from "./service";

export function learnerIdentity(user: { id: string; email?: string | null; nickname?: string | null }): LearnerIdentity {
  return { id: user.id, email: user.email || "", name: user.nickname || "" };
}

export function supportPaths(locale: string) {
  const root = `/${locale}/account/my-learning/support`;
  return { form: root, enquiries: `${root}/enquiries`, ticket: (id: string) => `${root}/${id}` };
}

/**
 * v4 Part A: where a signed-out learner goes to sign in, and back. Opened for
 * an order (?orderId= from a payment record), they come back to the same
 * order; the plain form's returnTo is exactly as before v4.
 */
export function supportSignInPath(locale: string, rawOrderId: string | string[] | undefined): string {
  const form = supportPaths(locale).form;
  const orderId = parseOrderIdParam(rawOrderId);
  return `/${locale}/portal/sign-in?returnTo=${orderId ? encodeURIComponent(`${form}?orderId=${orderId}`) : form}`;
}

/**
 * v4 Part A: the order Contact Support was opened for (?orderId=), when it is
 * the signed-in learner's own (lookup is learnerOrder for that learner). An
 * orderId that cannot be attached (malformed, someone else's, unknown, or the
 * order store failed) opens the plain form with orderUnavailable, so the page
 * says so instead of dropping it silently; it never says which of these it was.
 * POST /api/helpdesk/tickets checks ownership again.
 */
export async function supportOrder(raw: string | string[] | undefined, lookup: (orderId: string) => Promise<{ id: string } | null>): Promise<{ order: { id: string } | null; orderUnavailable: boolean }> {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value.trim() === "") return { order: null, orderUnavailable: false };
  const orderId = parseOrderIdParam(value);
  if (!orderId) return { order: null, orderUnavailable: true };
  try {
    const found = await lookup(orderId);
    return found && found.id === orderId ? { order: { id: found.id }, orderUnavailable: false } : { order: null, orderUnavailable: true };
  } catch {
    return { order: null, orderUnavailable: true };
  }
}
