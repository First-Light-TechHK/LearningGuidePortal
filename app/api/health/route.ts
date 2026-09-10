import { runtimeConfiguration } from "@/services/runtimeConfig";
import { deploymentReadiness } from "@/services/deploymentReadiness";

export const dynamic = "force-dynamic";

export async function GET() {
  const configuration = runtimeConfiguration();
  const readiness = await deploymentReadiness();
  return Response.json({
    ok: true,
    service: "learning-guide",
    environment: configuration.environment,
    version: process.env.APP_VERSION || "local",
    ready: readiness.ready,
    checks: readiness.checks,
    missing: configuration.missing
  }, { status: !readiness.ready ? 503 : 200, headers: { "Cache-Control": "no-store" } });
}
