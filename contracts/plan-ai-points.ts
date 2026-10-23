export type AiPointsPlan = {
  courseId: string;
  scope?: "course" | "category" | "everything";
  scopeId?: string | null;
  category?: string | null;
  device: "pc" | "mobile";
  termMonths: 6 | 12;
  aiPoints?: number;
};
