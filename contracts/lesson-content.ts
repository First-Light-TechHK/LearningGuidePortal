export type LessonNode = {
  id: string;
  title: string;
  type: "text" | "video" | "image" | "audio" | "model3d" | "exercise";
  active?: boolean;
  html?: string;
  url?: string;
  triggerTime: number;
  question?: string;
  answer?: string;
  options?: string[];
  correctOptions?: number[];
};

export type LessonContent = {
  id: string;
  title: string;
  type: "text" | "video" | "pdf";
  mode: "lecture" | "interactive";
  active?: boolean;
  html?: string;
  url?: string;
  nodes: LessonNode[];
};

export const LESSON_CONTENT_LIMITS = {
  contents: 100,
  nodesPerContent: 200,
  nodesPerLesson: 1000,
  htmlCharacters: 200_000,
  lessonBytes: 1_500_000,
  titleCharacters: 255,
  triggerSeconds: 36_000,
  options: 20,
} as const;

export const COURSE_MEDIA_MAX_BYTES = 25 * 1024 * 1024;

export type CourseMediaAsset = {
  id: string;
  courseId: string;
  url: string;
  originalName: string;
  mimeType: string;
  fileType: "image" | "video" | "pdf" | "audio" | "model3d";
  extension: string;
  size: number;
  createdAt: string;
};
