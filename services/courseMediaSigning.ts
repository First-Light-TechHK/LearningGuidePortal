import { signCourseMediaUrl } from "@/services/persistence/s3";

export async function signCourseMediaReferences<T>(value: T): Promise<T> {
  if (typeof value === "string") return await signCourseMediaUrl(value) as T;
  if (Array.isArray(value)) return await Promise.all(value.map((item) => signCourseMediaReferences(item))) as T;
  if (value && typeof value === "object") {
    const entries = await Promise.all(Object.entries(value as Record<string, unknown>).map(async ([key, item]) => [key, await signCourseMediaReferences(item)] as const));
    return Object.fromEntries(entries) as T;
  }
  return value;
}
