/**
 * Tolerant types for the Admin Portal projection API (v1.2, `docs/Portal_Projection_API.md`).
 *
 * Admin is the single writer for course content and Portal only consumes the
 * read-only projection. Every field except the course id is therefore optional:
 * Portal must keep rendering when Admin adds, renames or omits a field, and must
 * never crash on a shape it does not recognise.
 */

export type AdminProjectionEnvelope<T> = {
  success?: boolean;
  data?: T;
  error?: { code?: string; message?: string } | null;
  message?: string;
};

export type AdminCourseSummary = {
  id: string;
  slug?: string;
  code?: string;
  title?: string;
  subtitle?: string | null;
  shortDescription?: string | null;
  description?: string | null;
  category?: string | null;
  level?: string | null;
  tags?: unknown;
  referencePrice?: number | null;
  discount?: number | null;
  coverUrl?: string | null;
  lessonCount?: number;
  totalDurationSeconds?: number;
  learningMode?: string | null;
  learningLanguages?: unknown;
};

export type AdminProjectionTrial = {
  videoCutoffSeconds?: number | null;
  textCutoffLearningPointId?: string | null;
  textCutoffCode?: string | null;
};

export type AdminProjectionNode = {
  id?: string;
  title?: string;
  type?: string;
  url?: string;
  triggerTime?: number;
};

export type AdminProjectionContent = {
  id?: string;
  title?: string;
  type?: string;
  mode?: string;
  url?: string;
  html?: string;
  nodes?: unknown;
};

export type AdminProjectionLesson = {
  id?: string;
  title?: string;
  summary?: string | null;
  durationSeconds?: number | null;
  isPublic?: boolean;
  trial?: AdminProjectionTrial | null;
  contents?: unknown;
};

export type AdminProjectionSection = {
  id?: string;
  title?: string;
  lessons?: unknown;
};

export type AdminCourseDetail = AdminCourseSummary & {
  defaultContentLanguage?: string;
  whatYouLearn?: unknown;
  provides?: unknown;
  trial?: { enabled?: boolean; lessonIds?: unknown } | null;
  plans?: unknown;
  sections?: unknown;
};
