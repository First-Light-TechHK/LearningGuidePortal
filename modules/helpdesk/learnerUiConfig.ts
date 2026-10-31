// Server-side source of the numbers the learner Helpdesk pages need. The
// client bundle never imports contracts/helpdesk.ts (it pulls in node:crypto),
// so the pages receive this plain object as a prop. Every value comes from the
// contract, so client checks always mirror the server's.
import { HELPDESK_LIMITS, TICKET_CATEGORIES, type HelpdeskAttachmentType } from "@/contracts/helpdesk";
import type { HelpdeskUiConfig } from "./learnerUi";

/** File extensions the picker offers for each server-accepted type (the server still checks the bytes). */
const EXTENSIONS: Record<HelpdeskAttachmentType, readonly string[]> = {
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/webp": ["webp"],
  "image/gif": ["gif"],
  "application/pdf": ["pdf"],
  "text/plain": ["txt"],
  "text/csv": ["csv"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"]
};

export function helpdeskUiConfig(): HelpdeskUiConfig {
  const extensions = Object.values(EXTENSIONS).flat();
  return {
    categories: [...TICKET_CATEGORIES],
    limits: {
      maxFiles: HELPDESK_LIMITS.filesPerMessage,
      maxFileBytes: HELPDESK_LIMITS.fileMaxBytes,
      subjectMax: HELPDESK_LIMITS.subjectMax,
      bodyMax: HELPDESK_LIMITS.bodyMax,
      emailMax: HELPDESK_LIMITS.contactEmailMax,
      questionMax: HELPDESK_LIMITS.assistQuestionMax
    },
    extensions,
    accept: extensions.map((extension) => `.${extension}`).join(",")
  };
}
