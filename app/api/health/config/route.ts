import { runtimeConfiguration } from "@/services/runtimeConfig";
import { deploymentReadiness } from "@/services/deploymentReadiness";

export const dynamic = "force-dynamic";

export async function GET() {
  const configuration = runtimeConfiguration();
  const readiness = await deploymentReadiness();
  return Response.json({ ...configuration, ...readiness }, {
    status: readiness.ready ? 200 : 503,
    headers: { "Cache-Control": "no-store" }
  });
}
