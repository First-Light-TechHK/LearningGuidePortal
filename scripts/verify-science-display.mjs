import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const katex = require("katex");

const formulas = [
  String.raw`\mathcal{F}\equiv -(\mathrm{OLR}(q_f)-\mathrm{OLR}(q_i)),\qquad \mathrm{ECS}=\frac{F_{2x}}{\kappa}`,
  String.raw`\mathcal{H}_0=-\hbar\gamma B_0 I_z=-\hbar\omega_0 I_z`,
  String.raw`\frac{dS}{dt}=-\frac{\beta IS}{N},\quad \frac{dI}{dt}=\frac{\beta IS}{N}-\gamma I,\quad R_0=\beta/\gamma`,
  String.raw`s_L=\frac{wL}{Y}`,
  String.raw`\widehat{\beta}^{2\times 2}_{jU}=(\bar y^{\mathrm{POST}(j)}_j-\bar y^{\mathrm{PRE}(j)}_j)-(\bar y^{\mathrm{POST}(j)}_U-\bar y^{\mathrm{PRE}(j)}_U)`
];

const figures = [
  "gw/jeevanjee_2022_fig1_rce.png",
  "gw/jeevanjee_2022_eq11_13.png",
  "qc/vandersypen_2004_fig1_levels.png",
  "ep/bertozzi_2020_eq4_sir.png",
  "ep/bertozzi_2020_fig2_sir.png",
  "al/acemoglu_2019_fig1_tasks.png",
  "pp/goodman_bacon_2018_fig1_did.png"
];

const topicFile = await readFile(path.join(root, "services", "scienceTopics.ts"), "utf8");
const missingFigures = [];
for (const name of figures) {
  const rel = `/science-sources/${name}`;
  if (name.includes("fig1_levels") || name.includes("eq11") || name.includes("eq4")) {
    if (!topicFile.includes(rel) && !topicFile.includes(name.split("/").pop())) {
      missingFigures.push(`${name} not referenced in scienceTopics.ts`);
    }
  } else if (!topicFile.includes(rel)) {
    missingFigures.push(`${name} not referenced in scienceTopics.ts`);
  }
  try {
    await access(path.join(root, "public", "science-sources", name));
  } catch {
    missingFigures.push(`${name} missing from public/science-sources`);
  }
}

const failedFormulas = [];
for (const tex of formulas) {
  try {
    const html = katex.renderToString(tex, { displayMode: true, throwOnError: true, output: "html" });
    if (!html.includes("katex")) failedFormulas.push(tex);
  } catch (error) {
    failedFormulas.push(`${tex} -> ${error instanceof Error ? error.message : error}`);
  }
}

if (!topicFile.includes("$$") || !topicFile.includes("![") ) {
  failedFormulas.push("scienceTopics.ts is missing display math or markdown images");
}

if (failedFormulas.length || missingFigures.length) {
  console.error("Science display check failed.");
  for (const item of [...failedFormulas, ...missingFigures]) console.error(`- ${item}`);
  process.exit(1);
}

console.log(`Science display check passed: ${formulas.length} formulas, ${figures.length} figures.`);
