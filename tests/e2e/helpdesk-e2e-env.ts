// Local-only values for the Helpdesk e2e run (tests/e2e/helpdesk-support.spec.ts).
// These are throwaway test tokens for a dev server on 127.0.0.1 and a stub
// Admin server started by playwright.e2e.config.ts; they are not secrets and
// are never used outside a local test run.
export const HELPDESK_E2E = {
  adminPort: Number(process.env.E2E_HELPDESK_ADMIN_PORT || 3913),
  portalToken: "e2e-local-portal-helpdesk-token-not-a-secret",
  adminToken: "e2e-local-admin-helpdesk-token-not-a-secret"
} as const;

export const helpdeskAdminStubUrl = () => `http://127.0.0.1:${HELPDESK_E2E.adminPort}`;

/** Env added to the local dev server so the Helpdesk pages talk to the stub Admin. */
export function helpdeskE2eServerEnv() {
  return {
    PORTAL_HELPDESK_TOKEN: HELPDESK_E2E.portalToken,
    ADMIN_HELPDESK_BASE_URL: helpdeskAdminStubUrl(),
    ADMIN_HELPDESK_TOKEN: HELPDESK_E2E.adminToken
  };
}
