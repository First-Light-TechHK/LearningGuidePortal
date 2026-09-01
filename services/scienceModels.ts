export type ScienceModelSpec = {
  knowledgeId: string;
  title: string;
  src: string;
  defaultSummary: string;
};

export const SCIENCE_MODELS: ScienceModelSpec[] = [
  {
    knowledgeId: "global-warming",
    title: "Forcing, feedback, and temperature",
    src: "/science-models/global-warming.html",
    defaultSummary: "F = 4.0 W m⁻², κ = 2.0 W m⁻² K⁻¹, ΔT = F/κ = 2.0 K. A single summer is not ECS."
  },
  {
    knowledgeId: "quantum-computing",
    title: "Two-level control, not Shor",
    src: "/science-models/quantum-computing.html",
    defaultSummary: "On resonance: a driven π pulse inverts the two-level system. Detuning ≠ 0: inversion is incomplete. This is not Shor’s algorithm."
  },
  {
    knowledgeId: "epidemic",
    title: "SIR stocks, not the case curve",
    src: "/science-models/epidemic.html",
    defaultSummary: "R₀ = 3, γ = 1. Peak of i is at s = 1/R₀ = 1/3. Reported cases are not I."
  },
  {
    knowledgeId: "gene-edit",
    title: "Locus, product, reported follow-up",
    src: "/science-models/gene-edit.html",
    defaultSummary: "BCL11A erythroid enhancer → ΔHbF → named endpoint at 18 months. The 18-month visit is not a lifetime."
  },
  {
    knowledgeId: "ai-and-labour",
    title: "Tasks, automation I, new tasks N",
    src: "/science-models/ai-and-labour.html",
    defaultSummary: "I has moved right (automation). N is unchanged until new tasks are observed. Hours are not the labour share."
  },
  {
    knowledgeId: "public-policy",
    title: "2×2 difference-in-differences",
    src: "/science-models/public-policy.html",
    defaultSummary: "Treat change = −15 pp, comparison change = −4 pp, DD = −11 pp. A single 15 per cent is not this estimator."
  }
];

export function scienceModelForKnowledge(knowledgeId: string) {
  return SCIENCE_MODELS.find((model) => model.knowledgeId === knowledgeId) || null;
}

export function sanitiseModelState(value: unknown) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, 2000);
}
