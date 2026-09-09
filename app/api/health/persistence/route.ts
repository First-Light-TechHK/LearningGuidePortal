import { NextResponse } from "next/server";
import { persistenceEnabled } from "@/services/persistence/config";
import { ensureSchema, query } from "@/services/persistence/db";

export const runtime = "nodejs";

export async function GET() {
  const enabled = persistenceEnabled();
  const hasDatabaseUrl = Boolean(process.env.DATABASE_URL?.trim());
  const hasBucket = Boolean(process.env.DATA_S3_BUCKET?.trim());
  let table = null as string | null;
  let rowCount: number | null = null;
  let dbError: string | null = null;

  if (enabled) {
    try {
      await ensureSchema();
      const reg = await query<{ to_regclass: string | null }>("SELECT to_regclass('public.app_files') AS to_regclass");
      table = reg.rows[0]?.to_regclass || null;
      const count = await query<{ count: string }>("SELECT COUNT(*)::text AS count FROM app_files");
      rowCount = Number(count.rows[0]?.count || 0);
    } catch (error) {
      dbError = error instanceof Error ? error.message : String(error);
    }
  }

  return NextResponse.json({
    enabled,
    hasDatabaseUrl,
    hasBucket,
    table,
    dbError
  });
}
