import type { LessonContent } from "./lesson-content";

export type CourseMetadata = {
  subtitle?: string;
  cover?: string | null;
  level?: "" | "beginner" | "intermediate" | "advanced";
  tags?: string[];
  categoryId?: string | null;
  subjectId?: string | null;
  referencePrice?: number | null;
  discount?: number | null;
};

export type AuthoringLesson = {
  id: string;
  title: string;
  body: string;
  durationMinutes: number;
  videoDurationSeconds?: number | null;
  isPublic: boolean;
  contents?: LessonContent[];
};
export type CourseDraftInput = CourseMetadata & {
  expectedUpdatedAt: string;
  title: string;
  description: string;
  sections: Array<{ id: string; title: string; lessons: AuthoringLesson[] }>;
  removedSectionIds?: string[];
  removedLessonIds?: string[];
};

export type CatalogueEntry = {
  id: string;
  name: string;
  description: string;
  parentId: string | null;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
};

export type CatalogueInput = { name: string; description?: string; parentId?: string | null; expectedUpdatedAt?: string; status?: "active" | "archived" };
export type CourseListQuery = { search?: string; status?: "draft" | "published" | "archived" | "all"; categoryId?: string; subjectId?: string; level?: string; page?: number; pageSize?: number };
