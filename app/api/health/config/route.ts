import { runtimeConfiguration } from "@/services/runtimeConfig";
import { deploymentReadiness } from "@/services/deploymentReadiness";
import { tutorClientDiagnostics } from "@/services/ksTutorClient";

export const dynamic = "force-dynamic";

export async function GET() {
  const configuration = runtimeConfiguration();
  const readiness = await deploymentReadiness();
  // 2026-10-28 复盘 A3：AI Tutor 入口是否出现取决于 Portal → KS 的调用结果，
  // 而以前这里只有一个 `tutorSource: "ks" | "none"`，无法看出是"没配 Key"
  // 还是"配了但 KS 401"。暴露客户端诊断（不含密钥）便于一眼定位。
  const ksTutor = tutorClientDiagnostics();
  return Response.json({
    ...configuration,
    ...readiness,
    studyGroup: { ...readiness.studyGroup, ksTutor }
  }, {
    status: readiness.ready ? 200 : 503,
    headers: { "Cache-Control": "no-store" }
  });
}
