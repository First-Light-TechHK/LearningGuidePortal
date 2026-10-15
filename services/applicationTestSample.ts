import type { ApplicationTestAttempt, ApplicationTestSample } from "@/contracts/application-test";
import { APPLICATION_TEST_ANSWER_LIMIT, APPLICATION_TEST_EVALUATION_MS } from "@/contracts/application-test";
import type { Locale } from "@/lib/i18n/config";

/** Presentation-only sample; no external AI call or production assessment write. */
export function applicationEvaluationProgress(elapsedMs: number): number {
  return Math.max(0, Math.min(100, elapsedMs / APPLICATION_TEST_EVALUATION_MS * 100));
}
export function canSubmitApplicationAnswer(answer: string): boolean {
  return answer.trim().length > 0 && answer.length <= APPLICATION_TEST_ANSWER_LIMIT;
}
export function resolveApplicationAttempt(attempt: ApplicationTestAttempt, now: number): ApplicationTestAttempt {
  return attempt.phase === "evaluating" && attempt.startedAt !== null && now - attempt.startedAt >= APPLICATION_TEST_EVALUATION_MS
    ? { ...attempt, phase: "result" } : attempt;
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
    strengths: "你正确列出了收益矩阵，并求出鹰占 ⅔ 时的混合平衡。",
    improvement: "解释这个平衡点为什么稳定。例如，使用复制动态方程，说明种群在受到微小扰动后会回到鹰占 ⅔ 的比例。",
    sampleAnswer: "我认为稳定的混合种群大约由三分之二的鹰和三分之一的鸽组成。\n\n鹰遇到鹰时的平均收益为 −0.5（一半概率获得 +2，一半概率损失 −3）；鹰遇到鸽时总会获得 +2；鸽遇到鹰时收益为 0；两只鸽平分食物，各获得 +1。\n\n设鹰的比例为 X，鹰的适应度为 2 − 2.5X，鸽的适应度为 1 − X。令两者相等，得到 X = 2/3。",
    reference: [
      "这道题可以从微分方程、博弈论或生物学等角度回答。这里结合数学理论与生物学，先建立鹰与鸽相遇时的收益矩阵，再分析混合种群的平衡。",
      "鹰遇到鹰时，有 50% 的概率获胜（+2），50% 的概率失败（−3），期望收益为 0.5 × 2 + 0.5 × (−3) = −0.5。鹰遇到鸽时收益为 +2；鸽遇到鹰时收益为 0；鸽遇到另一只鸽时分享食物，各自收益为 +1。",
      "收益矩阵（行表示自身策略，列表示对方策略）：\n　　　　鹰　　 鸽\n鹰　　−0.5　　2\n鸽　　　0　　 1",
      "设 X 是鹰在种群中的比例，鸽的比例为 1 − X。复制动态方程为：\ndX/dT = (f(鹰) − f(鸽)) X(1 − X)。\n它描述两种基因型的适应度差异如何改变种群构成。",
      "平衡时 dX/dT = 0。X = 0 或 X = 1 分别对应全鸽或全鹰，但题目要求的是两者共存的混合平衡，因此需要令 f(鹰) = f(鸽)。",
      "根据收益矩阵：\nf(鹰) = −0.5X + 2(1 − X) = 2 − 2.5X\nf(鸽) = 0X + 1(1 − X) = 1 − X。",
      "令二者相等：\n2 − 2.5X = 1 − X\n1 − 1.5X = 0\nX = 2/3。\n因此稳定的混合种群中，鹰占 ⅔，鸽占 ⅓。"
    ]
  } : {
    id: "sample-hawks-doves",
    paragraphs: [
      "Suppose an animal population has two genotypes: black hawks and white doves. They continually compete for the same food source.",
      "Hawks always fight when they meet other birds. Doves never fight. They either let hawks eat all the food or share the food with another dove.",
      "If a hawk competes with another hawk for food, its survival rate decreases by a factor of 3 when it fights and loses and increases by 2 if it wins. It has a 50% chance of winning. If it competes with a dove, it always increases its survival rate by 2, since the dove doesn’t fight. A dove’s survival rate is unchanged if it meets a hawk. If it meets another dove, the food would increase its survival rate by the same value of 2, but it shares the food equally with the other dove.",
      "What mixed population of hawks and doves will be a stable equilibrium?"
    ],
    strengths: "You set up the payoff matrix correctly and found the mixed equilibrium at ⅔ hawks.",
    improvement: "Explain why this point is stable. For example, use the replicator equation to show the population moves back to ⅔ after a small change.",
    sampleAnswer: "I think the stable mix is about two thirds hawks and one third doves.\n\nA hawk meeting a hawk averages −0.5 (half the time +2, half the time −3). A hawk meeting a dove always gets +2, a dove meeting a hawk gets 0, and two doves share the food, so each gets +1.\n\nIf X is the share of hawks, a hawk’s fitness is 2 − 2.5X and a dove’s fitness is 1 − X. Setting them equal gives X = 2/3.",
    reference: [
      "There are different ways of answering this question, depending on what the focus of the teaching is: differential equations, game theory or biology. Let’s assume it’s a combination: it’s about learning to applying mathematical theory to biology. Then a good answer would look like something like the following:",
      "A: Mathematically, this sounds like a problem to find the equilibrium points of a differential equation with two variables. And specifically in biology this seems like a straightforward ecological system without any constraints on upper or lower limits where two genotypes interact. That calls for a game theoretic approach and the place to start is the payoff matrix for the hawk and dove encounters.",
      "Let’s start with the Hawks. When a Hawk meets a Hawk, then 50% of the time the first hawk wins (+2), and 50% of the time it loses (-3). So expected payoff = (0.5 * 2) + (0.5 * -3) = -0.5. If a Hawk meets a Dove, then that’s always +2, so payoff is +2. If a Dove meets a Hawk, it never competes for food, so there is no impact on survival, and payoff is 0. If a Dove meets another Dove, then the food (+2) is shared, so payoff is (0.5 * 2) = 1.",
      "This gives the following payoff matrix:\n\tHawk\tDove\nHawk\t-0.5\t2\nDove\t0\t1",
      "Now for the differential equation that describes how the composition of a two genotype population changes depending on the fitness of the population genotypes:\n dX/dT = (f(a) − f(b)) * X * (1 − X).",
      "This is the replicator formula. In other words, the change in one genotype’s proportion of a population over time (dX/dT) is calculated using two functions: the difference between that genotype’s fitness and the other genotype’s fitness (f(a) − f(b)) and the frequency with which that genotype competes with the other genotype, calculated as the product of their respective proportions of the total population. If one genotype’s proportion of the population is ¼, then the other genotype’s proportion is 1 − ¼, i.e. ¾.",
      "An equilibrium point is reached when dX/dT = 0. Mathematically, an equilibrium is reached when the population is all Hawks or all Doves, i.e. if X means the Hawk proportion of the population, when 1 − X = 0 or X = 0. But the question asks us to find an equilibrium that is a mixed population of Hawks and Doves.",
      "To find that equilibrium, we need to expand the expression (f(a) − f(b)) and solve for where (f(a) − f(b)) = 0. We can expand this expression by going back to the payoff matrix and adding in frequency information. Assume again that X is the proportion of Hawks in a population. Then the Hawk’s fitness will be:\n−0.5X + 2(1 − X)\n= 2 − 2.5X.",
      "Similarly for Doves:\n0X + 1(1 − X)\n= 1 − X.",
      "So the mixed equilibrium point will be where:\n2 − 2.5X = 1 − X\n1 − 1.5X = 0\n2/3 = X.\nSo the Hawk population, as the fitter genotype, is ⅔ of the population and the Doves are therefore ⅓."
    ]
  };
}
