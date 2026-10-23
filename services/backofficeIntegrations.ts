import type { BackofficeMenu } from "@/lib/backofficeRbac";

type IntegratedMenu = Extract<BackofficeMenu, "knowledge" | "aiTutor">;

// Knowledge and AI Tutor are owned by a separate team and backend; BackOffice
// only links them into the menu. Until their front end is deployed, the menus
// open the in-app Knowledge System pages that exist today.
const DEFAULTS: Record<IntegratedMenu, string> = {
  knowledge: "/knowledge/philosophy/epicureanism/knowledge-wiki",
  aiTutor: "/knowledge/philosophy/epicureanism/chat-testing"
};

const ENV: Record<IntegratedMenu, string> = {
  knowledge: "BACKOFFICE_KNOWLEDGE_URL",
  aiTutor: "BACKOFFICE_AI_TUTOR_URL"
};

export function backofficeIntegrationUrl(menu: IntegratedMenu, env: Record<string, string | undefined> = process.env): string {
  const configured = env[ENV[menu]]?.trim();
  if (configured) {
    if (configured.startsWith("/") && !configured.startsWith("//")) return configured;
    try { if (new URL(configured).protocol === "https:") return configured; } catch { /* fall back */ }
  }
  return DEFAULTS[menu];
}
