import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";
import { appEnvironment } from "@/services/runtimeConfig";

/**
 * Full-width Sandbox environment banner (Sandbox plan §6).
 *
 * Shown only when the server-side `APP_ENV` is exactly `SANDBOX`; SIT/UAT/PROD/DEV
 * render nothing. It sits in normal document flow at the top of every learner page
 * (never `position: fixed`), so it cannot cover the header. Deliberately not
 * dismissible: a tester must not mistake Sandbox for the live site.
 */
export function SandboxEnvironmentBadge({ locale }: { locale: string }) {
  if (appEnvironment() !== "SANDBOX") return null;
  const copy = getMessages(localeFrom(locale)).portal.sandbox;
  return (
    <div className="sandbox-environment-badge" role="status" data-environment="sandbox" aria-label={copy.label}>
      <span className="sandbox-environment-badge__tag">{copy.label}</span>
      <span className="sandbox-environment-badge__text">{copy.message}</span>
    </div>
  );
}
