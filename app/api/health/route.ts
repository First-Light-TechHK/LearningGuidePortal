export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    ok: true,
    service: "learning-guide",
    environment: process.env.APP_ENV || process.env.NODE_ENV || "development",
    version: process.env.APP_VERSION || "local"
  });
}
