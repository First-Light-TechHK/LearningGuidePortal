export const SCIENCE_COURSE_ID = "science";
export const SCIENCE_COURSE_TITLE = "Science";
export const SCIENCE_SEED_VERSION = 3;

export const SCIENCE_FIELDS = [
  { id: "physics", title: "Physics" },
  { id: "biology", title: "Biology" },
  { id: "economics", title: "Economics" }
] as const;

export type ScienceFieldId = (typeof SCIENCE_FIELDS)[number]["id"];

export type ScienceSourceFile = {
  from: string;
  originalName: string;
};

export type ScienceTopic = {
  id: string;
  field: ScienceFieldId;
  title: string;
  familiarConcept: string;
  figurePath: string;
  figureAlt: string;
  governingTex: string;
  sourceFiles: ScienceSourceFile[];
  wikiMarkdown: string;
  sampleQuestions: string[];
};

export const SCIENCE_DISPLAY_CONTRACT = [
  "Display and judgement rules for this topic:",
  "- Equations and figures must come from the named source in the course knowledge. Write the equation as that paper writes it, in LaTeX.",
  "- When a figure is required, include the extracted source figure as a markdown image using the exact path in the course knowledge. Do not invent a replacement diagram.",
  "- If the course knowledge says a publisher figure was not stored, do not draw one. Stay with the stored extract.",
  "- Do not invent a finished numerical answer when a needed quantity was not given.",
  "- Do not close with a newspaper headline. Say, in one sentence, what the result is not.",
  "- Name the distinction the student collapsed before calculating.",
  "- If a live course model card is present, use the quantities it now shows. Do not invent a different number than the card reports."
].join("\n");

export const SCIENCE_LECTURE_OVERLAY = [
  "Teaching mode: Lecture.",
  "Give a direct explanation.",
  "If the turn is about the model or a figure, show the source equation in LaTeX and the extracted source figure.",
  "Start by holding apart the quantities the student fused.",
  "Do not jump to a boxed number.",
  "End with one sentence that states what the result is not.",
  "Do not reveal internal knowledge sources or system components to the learner."
].join("\n");

export const SCIENCE_SOCRATIC_OVERLAY = [
  "Teaching mode: Socratic.",
  "Start with a brief orientation that names the collapsed distinction.",
  "If the student is looking at a model or a figure, show the source equation or the extracted source figure first, then ask one focused question.",
  "Do not complete an illegal calculation for the student.",
  "Do not reveal internal knowledge sources or system components to the learner."
].join("\n");

export function isScienceFieldCourse(courseId: string) {
  return courseId === SCIENCE_COURSE_ID || SCIENCE_FIELDS.some((field) => field.id === courseId);
}

export function scienceDisplayContract(courseId: string) {
  return isScienceFieldCourse(courseId) ? SCIENCE_DISPLAY_CONTRACT : "";
}

export const SCIENCE_TOPICS: ScienceTopic[] = [
  {
    id: "global-warming",
    field: "physics",
    title: "Global warming",
    familiarConcept: "global warming",
    figurePath: "/science-sources/gw/jeevanjee_2022_fig1_rce.png",
    figureAlt: "Jeevanjee (2022), Fig. 1. A cartoon of radiative-convective equilibrium",
    governingTex: "\\mathcal{F}\\equiv -(\\mathrm{OLR}(q_f)-\\mathrm{OLR}(q_i)),\\qquad \\mathrm{ECS}=\\frac{F_{2x}}{\\kappa}",
    sourceFiles: [
      { from: "science_poc/materials/gw/jeevanjee_2022_climate_sensitivity_chalkboard.pdf", originalName: "jeevanjee_2022_climate_sensitivity_chalkboard.pdf" },
      { from: "science_poc/materials/gw/ipcc_ar6_wg1_ch07.pdf", originalName: "ipcc_ar6_wg1_ch07.pdf" }
    ],
    sampleQuestions: [
      "What does Jeevanjee’s Fig. 1 keep apart?",
      "Write Jeevanjee’s forcing and ECS as the paper writes them.",
      "Why is 2.2 W m^{-2} not a temperature rise?"
    ],
    wikiMarkdown: `## Source materials

Retrieved files for this topic:

- Jeevanjee, N. (2022/2023). Climate sensitivity from radiative-convective equilibrium: a chalkboard approach. *Am. J. Phys.* 91: 731. Local file: \`jeevanjee_2022_climate_sensitivity_chalkboard.pdf\`.
- IPCC (2021). AR6 WGI Chapter 7. Local file: \`ipcc_ar6_wg1_ch07.pdf\`. Used for the public definition of ECS, not for a redrawn budget.

Do not replace these with a teaching cartoon that is not in the files.

## The public word

The public phrase *global warming* fuses a forcing, a feedback parameter, and a temperature change. Jeevanjee keeps them apart. A local summer is not ECS.

## Governing form, as written

Jeevanjee (2023), Eqs. (11)–(13). Forcing is the change in $-\\mathrm{OLR}$ at fixed $T_s$:

$$\\mathcal{F}\\equiv -(\\mathrm{OLR}(q_f)-\\mathrm{OLR}(q_i))$$

The feedback parameter is $\\kappa\\equiv -(\\mathrm{dOLR}/\\mathrm{d}T_s)$ at fixed $q$. In equilibrium $\\Delta T_s=F/\\kappa$. For a doubling,

$$\\mathrm{ECS}=F_{2x}/\\kappa$$

The paper’s comprehensive value is $F_{2x}\\approx 4\\,\\mathrm{W\\,m^{-2}}$ (Eq. 14). $2.2\\,\\mathrm{W\\,m^{-2}}$ is a forcing, not a temperature.

The same identities as they appear on the retrieved page:

![Jeevanjee (2023), forcing definition, Eq. (11)](/science-sources/gw/jeevanjee_2022_eq11_13.png)

## Named figure, from the paper

Jeevanjee, Fig. 1: radiative processes on the left, convective flux $F_c$ on the right. Point to the fluxes the paper labels. The early $T(t)$ is not this equilibrium cartoon.

![Jeevanjee (2022), Fig. 1. A cartoon of radiative-convective equilibrium](/science-sources/gw/jeevanjee_2022_fig1_rce.png)

## Refused poor form

Refuse a fitted straight line through two annual temperatures. Refuse inventing $288\\,\\mathrm{K}$ or albedo $0.3$ unless the student named them as Jeevanjee’s stated standard.

## Fence

A no-feedback rise, or a first-year transient, is not “the warming we shall see”.

## When the student fails

- Fuses the public word: name $F$, $\\kappa$, and $\\Delta T$; do not calculate yet.
- Fits a news-line: name the refused form; load Jeevanjee’s forcing–feedback pair.
- Invents $288\\,\\mathrm{K}$ or albedo: stop.
- Reports $2.2\\,\\mathrm{W\\,m^{-2}}$ as degrees: type-check.
- Ignores the labelled fluxes in Fig. 1: point to them.
- Closes with the newspaper sentence: fence.
`
  },
  {
    id: "quantum-computing",
    field: "physics",
    title: "Quantum computing",
    familiarConcept: "quantum computing",
    figurePath: "/science-sources/qc/vandersypen_2004_fig1_levels.png",
    figureAlt: "Vandersypen & Chuang (2004), single-spin Hamiltonian, Eq. (1)",
    governingTex: "\\mathcal{H}_0=-\\hbar\\gamma B_0 I_z=-\\hbar\\omega_0 I_z=\\begin{bmatrix}-\\hbar\\omega_0/2 & 0\\\\ 0 & \\hbar\\omega_0/2\\end{bmatrix}",
    sourceFiles: [
      { from: "science_poc/materials/qc/preskill_2018_nisq.pdf", originalName: "preskill_2018_nisq.pdf" },
      { from: "science_poc/materials/qc/vandersypen_chuang_2004_nmr_qc.pdf", originalName: "vandersypen_chuang_2004_nmr_qc.pdf" }
    ],
    sampleQuestions: [
      "Write the single-spin Hamiltonian as Vandersypen and Chuang write it.",
      "What does Preskill’s NISQ paragraph refuse?",
      "Why is a driven two-level rotation not Shor’s algorithm?"
    ],
    wikiMarkdown: `## Source materials

Retrieved files:

- Preskill, J. (2018). Quantum computing in the NISQ era and beyond. *Quantum.* arXiv:1801.00862. Local file: \`preskill_2018_nisq.pdf\`. No figures; use the opening definition.
- Vandersypen, L. M. K., & Chuang, I. L. (2004). NMR techniques for quantum control and computation. arXiv:quant-ph/0404064. Local file: \`vandersypen_chuang_2004_nmr_qc.pdf\`.

An earlier file stored under the old arXiv id was the wrong paper (Christandl et al. on QKD). It is not a source for this topic.

## The public word

The public phrase *quantum computing* fuses amplitudes, one measurement, and an unfinished algorithm. Preskill: a NISQ device is noisy and not yet error-corrected; it is not Shor’s engine.

## Governing form, as written

Vandersypen & Chuang (2004), Eq. (1), single spin-1/2 in $\\vec B_0$ along $\\hat z$:

$$\\mathcal{H}_0=-\\hbar\\gamma B_0 I_z=-\\hbar\\omega_0 I_z=\\begin{bmatrix}-\\hbar\\omega_0/2 & 0\\\\ 0 & \\hbar\\omega_0/2\\end{bmatrix}$$

A driven rotation is a laboratory control of this two-level system. Complete inversion is not licensed if detuning was not given. “0 and 1 at once” is not this Hamiltonian.

![Vandersypen & Chuang (2004), Eq. (1), the system Hamiltonian](/science-sources/qc/vandersypen_2004_fig1_levels.png)

## Named figure, from the paper

The equation block above is the retrieved page, not a redrawn Bloch sphere. Preskill’s paper has no figure to display.

## Refused poor form

Refuse “0 and 1 at once, so $P=1/2$”. Load Eq. (1). A 50-qubit noisy register is Preskill’s NISQ step, not Shor.

## Fence

A Rabi / NMR control sequence is not “how Shor’s algorithm works”.

## When the student fails

- Fuses amplitudes, measurement, and algorithm: split the three objects.
- Writes “both 0 and 1”: refuse; load $\\mathcal{H}_0$.
- Sets detuning to zero without warrant: stop.
- Calls a detuned frame complete inversion: name the on-resonance condition in the paper.
- Treats a control diagram as the machine: point to the two-level Hamiltonian.
- Closes with Shor: fence.
`
  },
  {
    id: "epidemic",
    field: "biology",
    title: "Epidemic",
    familiarConcept: "epidemic",
    figurePath: "/science-sources/ep/bertozzi_2020_fig2_sir.png",
    figureAlt: "Bertozzi et al. (2020), Figure 2. Dimensionless SIR solution",
    governingTex: "\\frac{dS}{dt}=-\\frac{\\beta IS}{N},\\quad \\frac{dI}{dt}=\\frac{\\beta IS}{N}-\\gamma I,\\quad \\frac{dR}{dt}=\\gamma I,\\quad R_0=\\beta/\\gamma",
    sourceFiles: [
      { from: "science_poc/materials/ep/bjornstad_2020_seir.pdf", originalName: "bertozzi_2020_modeling_covid19.pdf" },
      { from: "science_poc/materials/ep/weissman_2020_sir.pdf", originalName: "hebert_dufresne_2020_beyond_r0.pdf" }
    ],
    sampleQuestions: [
      "Write the SIR system as Bertozzi et al. write it.",
      "What does their Figure 2 mark at the infection peak?",
      "Why is a falling case-curve not a weaker virus?"
    ],
    wikiMarkdown: `## Source materials

Retrieved files:

- Bertozzi, A. L., et al. (2020). The challenges of modeling and forecasting the spread of COVID-19. arXiv:2004.04741. Local file stored as \`bjornstad_2020_seir.pdf\`.
- Hébert-Dufresne, L., et al. (2020). Beyond $R_0$. arXiv:2002.04004. Local file stored as \`weissman_2020_sir.pdf\`.

## The public word

Reported cases, the latent stock $I$, $R_0$, and $R_{\\mathrm{eff}}$ are not one quantity. Hébert-Dufresne et al. note that $R_0$ is commonly misapplied and that published case-counts are not the state.

## Governing form, as written

Bertozzi et al. (2020), Eq. (4):

$$\\frac{dS}{dt}=-\\frac{\\beta IS}{N},\\qquad \\frac{dI}{dt}=\\frac{\\beta IS}{N}-\\gamma I,\\qquad \\frac{dR}{dt}=\\gamma I$$

with $R_0=\\beta/\\gamma$. $\\beta$ is the transmission rate constant, $\\gamma$ the recovery rate constant.

![Bertozzi et al. (2020), Eq. (4)](/science-sources/ep/bertozzi_2020_eq4_sir.png)

## Named figure, from the paper

Bertozzi et al., Figure 2: $s$, $i$, $r$ against $\\tau$. The peak of $i$ is marked with $s=1/R_0$. The linear reported case-curve is not this figure.

![Bertozzi et al. (2020), Figure 2. Dimensionless SIR solution](/science-sources/ep/bertozzi_2020_fig2_sir.png)

## Refused poor form

Refuse a constant “3 per cent a day”. The infection term in Eq. (4) is $\\beta IS/N$. Do not invent $N$ or $\\gamma$.

## Fence

A falling reported curve is not “the virus has weakened”.

## When the student fails

- Reads cases as $I$ or as $R_0$: split the objects.
- Uses a constant percentage rate: refuse; load Eq. (4).
- Invents $N$ or $\\gamma$: stop.
- Claims 50% ends an $R_0=3$ epidemic: $H=1-1/R_0=2/3$.
- Ignores $s=1/R_0$ on Figure 2: point to it.
- Closes with a weaker virus: fence.
`
  },
  {
    id: "gene-edit",
    field: "biology",
    title: "Gene edit",
    familiarConcept: "gene edit",
    figurePath: "",
    figureAlt: "",
    governingTex: "\\text{BCL11A erythroid enhancer}\\;\\to\\;\\Delta\\mathrm{HbF}\\;\\to\\;\\text{named endpoint at reported follow-up}",
    sourceFiles: [
      { from: "science_poc/materials/ge/frangoul_2021_nejm_extract.txt", originalName: "frangoul_2021_nejm_extract.txt" }
    ],
    sampleQuestions: [
      "What three objects does the Frangoul extract keep apart?",
      "Why is the 18-month visit not a lifetime?",
      "What figure is missing, and why must we not invent one?"
    ],
    wikiMarkdown: `## Source materials

Stored source, extract only:

- Frangoul, H., et al. (2021). CRISPR-Cas9 gene editing for sickle cell disease and $\\beta$-thalassemia. *N. Engl. J. Med.* 384: 252–260.
- Local file: \`frangoul_2021_nejm_extract.txt\`.
- The publisher PDF was not stored. **Do not display a invented sequence diagram as if it were from the Journal.**

## The public word

The extract keeps three objects apart: the locus (BCL11A erythroid-specific enhancer, not $HBB$), the product (fetal haemoglobin), and the named clinical endpoint (transfusion independence; elimination of vaso-occlusive episodes).

## Governing form, from the extract

The legal sequence in the stored text is:

$$\\text{BCL11A erythroid enhancer}\\;\\to\\;\\Delta\\mathrm{HbF}\\;\\to\\;\\text{named endpoint at reported follow-up}$$

About 80% of alleles were modified in healthy-donor CD34+ cells. Two patients received autologous edited cells. More than a year later: high allelic editing, higher HbF, transfusion independence, and (SCD) elimination of vaso-occlusive episodes. Patient 1’s 18-month visit is a follow-up, not a lifetime.

## Named figure

None. The course does not have the Journal’s panels. Do not invent cut–repair–product artwork.

## Refused poor form

Refuse Mendel-as-trial. A one-locus map is not this extract. Do not bind 18 months to a lifetime.

## Fence

A named somatic trial at a reported follow-up is not “we have edited what makes us human”.

## When the student fails

- Fuses gene, product, and endpoint: split the three objects in the extract.
- Uses a Mendelian map as the trial: refuse.
- Binds 18 months to a lifetime: stop.
- Asks for a Journal figure we do not have: say it was not stored; do not draw one.
- Closes with a metaphysics of the human: fence.
`
  },
  {
    id: "ai-and-labour",
    field: "economics",
    title: "AI and labour",
    familiarConcept: "AI and labour",
    figurePath: "/science-sources/al/acemoglu_2019_fig1_tasks.png",
    figureAlt: "Acemoglu & Restrepo (2019), Figure 1. Allocation of capital and labour to tasks",
    governingTex: "Y=\\Pi(I,N)\\left(\\Gamma(I,N)^{1/\\sigma}(A^L L)^{(\\sigma-1)/\\sigma}+(1-\\Gamma(I,N))^{1/\\sigma}(A^K K)^{(\\sigma-1)/\\sigma}\\right)^{\\sigma/(\\sigma-1)}",
    sourceFiles: [
      { from: "science_poc/materials/al/acemoglu_restrepo_2019_nber_w25684.pdf", originalName: "acemoglu_restrepo_2019_nber_w25684.pdf" }
    ],
    sampleQuestions: [
      "What does Acemoglu and Restrepo’s Figure 1 move when automation rises?",
      "Write their production function, Eq. (1).",
      "What must be observed before new tasks can restore the labour share?"
    ],
    wikiMarkdown: `## Source materials

Retrieved file:

- Acemoglu, D., & Restrepo, P. (2019). Automation and new tasks. NBER Working Paper 25684. Local file: \`acemoglu_restrepo_2019_nber_w25684.pdf\`.

## The public word

Employment (or hours), the wage, and the labour share are not one headline. The paper’s objects are tasks, automation $I$, and new tasks $N$.

## Governing form, as written

Acemoglu & Restrepo (2019), Eq. (1):

$$Y=\\Pi(I,N)\\Big(\\Gamma(I,N)^{1/\\sigma}(A^L L)^{(\\sigma-1)/\\sigma}+(1-\\Gamma(I,N))^{1/\\sigma}(A^K K)^{(\\sigma-1)/\\sigma}\\Big)^{\\sigma/(\\sigma-1)}$$

An increase in $I$ is automation. An increase in $N$ is new labour-intensive tasks. New tasks are an observation, not a default. Cobb–Douglas, in which the labour share cannot move, cannot ask this question. The labour share identity $s_L=wL/Y$ is the accounting check, not a substitute for Eq. (1).

## Named figure, from the paper

Figure 1: tasks on $[N-1,N]$; capital on $[N-1,I]$; labour on $[I,N]$. Automation moves $I$ right. New tasks extend $N$.

![Acemoglu & Restrepo (2019), Figure 1. Allocation of capital and labour to tasks](/science-sources/al/acemoglu_2019_fig1_tasks.png)

## Refused poor form

Refuse Cobb–Douglas with a frozen $s_L=0.60$. Refuse inferring new tasks from 1820.

## Fence

“Just as in the industrial revolution, new jobs will appear” is not licensed until new tasks have been observed.

## When the student fails

- Reads hours as the whole claim: split hours, wage, and $s_L$.
- Keeps $s_L$ fixed: refuse; load Eq. (1) and Figure 1.
- Inserts new tasks without observation: stop.
- Moves hours only and does not recompute $wL/Y$: name the identity.
- Points at employment and calls it the share: point to $s_L$.
- Closes with the industrial-revolution headline: fence.
`
  },
  {
    id: "public-policy",
    field: "economics",
    title: "Public policy",
    familiarConcept: "public policy",
    figurePath: "/science-sources/pp/goodman_bacon_2018_fig1_did.png",
    figureAlt: "Goodman-Bacon (2018), Figure 1. Difference-in-differences with variation in treatment timing",
    governingTex: "\\widehat{\\beta}^{2\\times 2}_{jU}=(\\bar y^{\\mathrm{POST}(j)}_j-\\bar y^{\\mathrm{PRE}(j)}_j)-(\\bar y^{\\mathrm{POST}(j)}_U-\\bar y^{\\mathrm{PRE}(j)}_U)",
    sourceFiles: [
      { from: "science_poc/materials/pp/goodman_bacon_2018_did.pdf", originalName: "goodman_bacon_2018_did.pdf" }
    ],
    sampleQuestions: [
      "What three groups does Goodman-Bacon’s Figure 1 plot?",
      "Write a 2×2 DD as the paper writes it.",
      "Why is a single 15 per cent not that estimator?"
    ],
    wikiMarkdown: `## Source materials

Retrieved file:

- Goodman-Bacon, A. (2018). Difference-in-differences with variation in treatment timing. NBER Working Paper 25018. Local file: \`goodman_bacon_2018_did.pdf\`.

Leape (2006) on the London charge is cited for the public 15 per cent figure. That PDF was not stored. Do not invent a congestion-charge chart.

## The public word

“It worked” fuses an average effect, incidence, and a welfare claim. A single before-and-after is not Goodman-Bacon’s design.

## Governing form, as written

The paper’s canonical 2×2, treated group $j$ versus untreated $U$:

$$\\widehat{\\beta}^{2\\times 2}_{jU}=(\\bar y^{\\mathrm{POST}(j)}_j-\\bar y^{\\mathrm{PRE}(j)}_j)-(\\bar y^{\\mathrm{POST}(j)}_U-\\bar y^{\\mathrm{PRE}(j)}_U)$$

That is Treat $\\times$ Post. A missing comparison zone must not be invented. Parallel trends is the identifying assumption.

## Named figure, from the paper

Figure 1: untreated $U$, early-treated $k$ at $t_k^*$, late-treated $\\ell$ at $t_\\ell^*$. Sub-periods $\\mathrm{PRE}(k)$, $\\mathrm{MID}(k,\\ell)$, $\\mathrm{POST}(\\ell)$.

![Goodman-Bacon (2018), Figure 1. Difference-in-differences with variation in treatment timing](/science-sources/pp/goodman_bacon_2018_fig1_did.png)

## Refused poor form

Refuse the single 15 per cent with no comparison group. A before-and-after is not this figure.

## Fence

An $11$ percentage-point contrast is not “congestion charging works”. Incidence is not in that average.

## When the student fails

- Fuses ‘worked’: split average, incidence, and welfare.
- Uses 15 per cent alone: refuse; load the 2×2 and Figure 1.
- Invents the comparison 4 per cent: stop.
- Subtracts $15-0$: name Treat $\\times$ Post.
- Ignores a broken pre-trend: point to the pre-period on Figure 1.
- Closes with “charging works”: fence.
`
  }
];

export function scienceTopicById(id: string) {
  return SCIENCE_TOPICS.find((topic) => topic.id === id) || null;
}
