import type { ApplicationTestSample } from "@/contracts/application-test";
import { APPLICATION_TEST_ANSWER_LIMIT, APPLICATION_TEST_EVALUATION_MS } from "@/contracts/application-test";
import type { Locale } from "@/lib/i18n/config";

/** Presentation-only sample; no external AI call or production assessment write. */
export function applicationEvaluationProgress(elapsedMs: number): number {
  return Math.max(0, Math.min(100, elapsedMs / APPLICATION_TEST_EVALUATION_MS * 100));
}
export function canSubmitApplicationAnswer(answer: string): boolean {
  return answer.trim().length > 0 && answer.length <= APPLICATION_TEST_ANSWER_LIMIT;
}
export function getApplicationTestSample(locale: Locale): ApplicationTestSample {
  return locale === "zh-CN" ? {
    id: "sample-hawks-doves",
    paragraphs: [
      "假设某个动物种群有两种基因型：黑鹰和白鸽。它们持续争夺同一种食物来源。",
      "鹰遇到其他鸟时总会争斗。鸽从不争斗：它们要么让鹰吃掉全部食物，要么与另一只鸽分享食物。",
      "鹰与鹰争食时，输掉争斗会使其存活率减少 3，获胜则增加 2；获胜概率为 50%。鹰遇到鸽时，因为鸽不争斗，其存活率总会增加 2。鸽遇到鹰时存活率不变。鸽遇到另一只鸽时，食物同样使存活率增加 2，但食物由两只鸽平均分享。",
      "鹰和鸽分别占多少比例时，混合种群会达到稳定平衡？"
    ],
    strengths: "你的回答尝试用鹰和鸽的收益比较来分析种群平衡。",
    improvement: "明确列出两种策略的期望收益，并说明如何通过令收益相等来求平衡比例。"
  } : {
    id: "sample-hawks-doves",
    paragraphs: [
      "Suppose an animal population has two genotypes: black hawks and white doves. They continually compete for the same food source.",
      "Hawks always fight when they meet other birds. Doves never fight. They either let hawks eat all the food or share the food with another dove.",
      "If a hawk competes with another hawk for food, its survival rate decreases by a factor of 3 when it fights and loses and increases by 2 if it wins. It has a 50% chance of winning. If it competes with a dove, it always increases its survival rate by 2, since the dove doesn’t fight. A dove’s survival rate is unchanged if it meets a hawk. If it meets another dove, the food would increase its survival rate by the same value of 2, but it shares the food equally with the other dove.",
      "What mixed population of hawks and doves will be a stable equilibrium?"
    ],
    strengths: "Your response attempts to compare the payoffs of hawks and doves to explain population equilibrium.",
    improvement: "State the expected payoff for each strategy, then explain how equating the payoffs gives the equilibrium proportions."
  };
}
