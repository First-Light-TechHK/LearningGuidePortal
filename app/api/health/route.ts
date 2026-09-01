import { runtimeConfiguration } from "@/services/runtimeConfig";

export const dynamic = "force-dynamic";

export async function GET() {
  const configuration = runtimeConfiguration();
  return Response.json({
    ok: true,
    service: "learning-guide",
    environment: configuration.environment,
    version: process.env.APP_VERSION || "local",
    ready: configuration.ready,
    missing: configuration.missing
  }, { status: configuration.production && !configuration.ready ? 503 : 200 });
}
