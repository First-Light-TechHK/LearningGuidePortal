import { readFile } from "node:fs/promises";
import path from "node:path";
import { runtimeConfiguration } from "@/services/runtimeConfig";
import { deploymentReadiness } from "@/services/deploymentReadiness";

export const dynamic = "force-dynamic";

export async function GET() {
  const configuration = runtimeConfiguration();
  const readiness = await deploymentReadiness();
  let buildCommit: string | null = null;
  try {
    const parsed = JSON.parse(await readFile(path.join(process.cwd(), '.next', 'build-identity.json'), 'utf8'));
    if (typeof parsed.buildCommit === 'string' && /^[a-f0-9]{40}$/.test(parsed.buildCommit)) buildCommit = parsed.buildCommit;
  } catch { /* Missing or invalid build identity is never inferred from runtime env. */ }
  return Response.json({
    ok: true,
    service: "learning-guide",
    environment: configuration.environment,
    version: process.env.APP_VERSION || "local",
    buildCommit,
    ready: readiness.ready,
    checks: readiness.checks,
    missing: configuration.missing
  }, { status: !readiness.ready ? 503 : 200, headers: { "Cache-Control": "no-store" } });
}
