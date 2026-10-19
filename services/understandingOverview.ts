import type { UnderstandingOverviewDisplay } from "@/contracts/understanding-overview";
import type { Locale } from "@/lib/i18n/config";

/** Figma presentation samples only; never persisted as Study or assessment facts. */
export function sampleUnderstandingOverview(locale: Locale): UnderstandingOverviewDisplay {
  const titles = locale === "zh-CN" ? ["仔细观察", "阅读图像", "物品与记忆", "建立视觉词汇", "联系你的观察"] : ["Looking closely", "Reading images", "Objects and memory", "Building visual vocabulary", "Connecting your observations"];
  return { completed:2, total:8, percent:25, lessons:titles.map((title,index) => ({ number:String(index+1).padStart(2,"0"), title, state:index === 0 ? "completed" : index === 1 ? "current" : "locked" })) };
}
