import { readPublishedWiki } from "../app/lib/wiki-store";

export type ChatPromptBody = {
  topic?: string;
  mode: "lecture" | "socratic";
  prompts: {
    base: string;
    lecture: string;
    socratic: string;
  };
  knowledgePack: unknown;
  sources: string;
};

export async function buildSystemPrompt(body: ChatPromptBody) {
  const modePrompt = body.mode === "lecture" ? body.prompts.lecture : body.prompts.socratic;
  const publishedWiki = await readPublishedWiki(body.topic || "Epicureanism");
  return [
    body.prompts.base,
    modePrompt,
    "CURRENT CONVERSATION TOPIC:",
    body.topic || "Epicureanism",
    "PUBLISHED KS WIKI MARKDOWN FOR THIS TOPIC:",
    publishedWiki.markdown || "No published wiki markdown found for this topic yet.",
    "COURSE PACK JSON:",
    "Client-supplied knowledge packs are ignored. Use only the published wiki markdown above.",
    "SOURCE EXCERPTS:",
    "",
    "PROMPT CONTRACT:",
    "- First validate whether the student turn is relevant to the current topic or the course context.",
    "- If relevant, use the course pack and source excerpts.",
    "- If the student asks an understanding-test style answer, assess it against the rubric.",
    "- When the course names a governing equation, write it in LaTeX using $...$ or $$...$$.",
    "- When the course names a figure, include it as a markdown image using the exact path in the course pack.",
    "- Do not invent a finished number when a needed quantity was not given, and do not close with a newspaper headline.",
    "- Keep the response suitable for a student, not a research seminar."
  ].join("\n\n");
}
