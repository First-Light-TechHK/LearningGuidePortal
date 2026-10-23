// Seeds a verified BackOffice operator with an employee role in the local product store.
// Usage: node --import tsx --require ./scripts/register-tsconfig-paths.cjs tests/e2e/helpers/seed-backoffice-operator.ts <email> <password> <role>
import { isBackofficeRole } from "@/lib/backofficeRbac";
import { issueEmailVerificationToken, registerUser, setBackofficeRole, verifyEmailToken } from "@/services/productStore";

async function main() {
  const [email, password, role] = process.argv.slice(2);
  if (!email || !password || !isBackofficeRole(role)) throw new Error("email, password and a BackOffice role are required");
  const user = await registerUser({ email, password, nickname: "E2E Operator", locale: "en-GB", role: "operator" });
  await verifyEmailToken(await issueEmailVerificationToken(user.id, true));
  await setBackofficeRole(email, role);
}

main().catch((error) => { console.error(error); process.exit(1); });
