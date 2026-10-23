import type { BackofficeShellUser } from "@/components/portal/BackofficeShell";
import { getBackofficeShellMessages } from "@/lib/i18n/backofficeShellMessages";
import type { Locale } from "@/lib/i18n/config";
import { backofficeMenusFor, backofficeRoleOf } from "./backofficeAccess";
import type { ProductUser } from "./productStore";

/** Server-side shell data: the menus are decided here, never in the browser. */
export function backofficeShellProps(user: ProductUser, locale: Locale): { menus: ReturnType<typeof backofficeMenusFor>; user: BackofficeShellUser } {
  const roles = getBackofficeShellMessages(locale).roles;
  const role = backofficeRoleOf(user);
  // BR-PORT-018: the display name is the part of the login email before @.
  const name = user.email ? user.email.split("@")[0] : user.nickname;
  return { menus: backofficeMenusFor(user), user: { name, email: user.email, roleLabel: role ? roles[role] : roles.author } };
}
