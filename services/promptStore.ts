import path from "path";
import { readFile } from "fs/promises";

const PROMPT_ROOT = path.join(process.cwd(), "prompts");

export type DraftPromptName = "Draft_sysPrompt" | "Draft_ReqPrompt" | "Incremental_Draft_sysPrompt";

export async function readPromptFile(name: DraftPromptName) {
  try {
    return await readFile(path.join(PROMPT_ROOT, name), "utf8");
  } catch {
    throw new Error(`Missing prompt file: prompts/${name}`);
  }
}

export async function readDraftSysPrompt() {
  return readPromptFile("Draft_sysPrompt");
}

export async function readDefaultDraftRequirements() {
  return readPromptFile("Draft_ReqPrompt");
}

export async function readIncrementalDraftSysPrompt() {
  return readPromptFile("Incremental_Draft_sysPrompt");
}
