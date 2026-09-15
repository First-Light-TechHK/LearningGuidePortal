export type AuthoringLesson = {
  id: string;
  title: string;
  body: string;
  durationMinutes: number;
  videoDurationSeconds?: number | null;
  isPublic: boolean;
};
export type CourseDraftInput = {
  expectedUpdatedAt: string;
  title: string;
  description: string;
  sections: Array<{ id: string; title: string; lessons: AuthoringLesson[] }>;
};
