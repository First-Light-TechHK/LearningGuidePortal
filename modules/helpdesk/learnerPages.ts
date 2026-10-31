// Server-side helpers shared by the learner Helpdesk pages
// (app/[locale]/account/my-learning/support/**). Same identity mapping as the
// learner Route Handlers (modules/helpdesk/http.ts requireLearner).
import type { LearnerIdentity } from "./service";

export function learnerIdentity(user: { id: string; email?: string | null; nickname?: string | null }): LearnerIdentity {
  return { id: user.id, email: user.email || "", name: user.nickname || "" };
}

export function supportPaths(locale: string) {
  const root = `/${locale}/account/my-learning/support`;
  return { form: root, enquiries: `${root}/enquiries`, ticket: (id: string) => `${root}/${id}` };
}
