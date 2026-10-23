// Usage: npm run backoffice:role -- <operator-email> <role>
// Roles: admin, course_creator, graphic_designer, finance, operation_admin, operation_ai.
// Until Settings -> Employee Account exists, this is how an operator gets a role.
import { BACKOFFICE_ROLES, isBackofficeRole } from "@/lib/backofficeRbac";
import { setBackofficeRole } from "@/services/productStore";

async function main() {
  const [email, role] = process.argv.slice(2);
  if (!email || !isBackofficeRole(role)) {
    console.error(`Usage: npm run backoffice:role -- <operator-email> <${BACKOFFICE_ROLES.join("|")}>`);
    process.exit(2);
  }
  const user = await setBackofficeRole(email, role);
  console.log(`${user.email} -> ${user.backofficeRole}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
