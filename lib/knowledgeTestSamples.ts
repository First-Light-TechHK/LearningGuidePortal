import type { KnowledgeQuestion } from "@/contracts/knowledge-test";
import type { Locale } from "@/lib/i18n/config";

// Sample lesson content from the six distinct cards in Figma 1:1570, not UI translations.
const english: [string, string][] = [
  ["What is the definition of a dynamic system in mathematical terms?", "A dynamic system consists of a state space and a rule that describes how its state changes over time."],
  ["What determines the choice of variable to represent a dynamic system?", "Choose variables that capture the relevant state and allow the system’s evolution to be described for the purpose of the model."],
  ["What’s an example of a system that requires two variables to describe it?", "A pendulum needs both its angle and angular velocity to describe its state and predict its motion."],
  ["How do you add two vectors together?", "Add corresponding components: (a₁, a₂) + (b₁, b₂) = (a₁ + b₁, a₂ + b₂)."],
  ["What is a state space?", "A state space is the set of all possible states of a system. Each point represents one complete state."],
  ["What is a state variable?", "A state variable is one of the quantities needed to describe the system’s current state."],
];
const chinese: [string, string][] = [
  ["从数学角度看，动力系统的定义是什么？", "动力系统由状态空间和描述状态随时间变化的规则组成。"],
  ["选择哪些变量来表示动力系统，取决于什么？", "根据建模目的，选择能够描述系统相关状态并确定其演化的变量。"],
  ["请举一个需要两个变量来描述的系统的例子。", "单摆需要角度和角速度两个变量，才能描述当前状态并预测运动。"],
  ["如何将两个向量相加？", "将对应分量分别相加：(a₁, a₂) + (b₁, b₂) = (a₁ + b₁, a₂ + b₂)。"],
  ["什么是状态空间？", "状态空间是系统所有可能状态的集合，每个点表示一个完整的状态。"],
  ["什么是状态变量？", "状态变量是描述系统当前状态所需的一个量。"],
];
export function getKnowledgeTestSamples(locale: Locale): KnowledgeQuestion[] {
  return (locale === "zh-CN" ? chinese : english).map(([prompt, referenceAnswer], index) => ({ id: `sample-${index + 1}`, prompt, referenceAnswer }));
}
