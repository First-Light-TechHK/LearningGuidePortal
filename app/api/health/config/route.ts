import { runtimeConfiguration } from "@/services/runtimeConfig";

export const dynamic = "force-dynamic";

export async function GET() {
  const configuration = runtimeConfiguration();
  return Response.json(configuration, {
    status: configuration.ready ? 200 : 503,
    headers: { "Cache-Control": "no-store" }
  });
}
