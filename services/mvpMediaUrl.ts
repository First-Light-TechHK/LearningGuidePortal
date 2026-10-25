/** Legacy MVP object prefix. Signing lives in persistence; migrations must not embed hosts. */
export const LEGACY_COS_MVP_PREFIX = "https://learningguide-1380131816.cos.ap-hongkong.myqcloud.com/mvp/";
export const AWS_MVP_PREFIX = "https://aitutor-data-851987565851.s3.ap-southeast-1.amazonaws.com/learning-guide/dev/documents/mvp/";

const PLACEHOLDER = "__MVP_MEDIA__/";

export function materializeMvpMediaPlaceholder<T>(value: T): T {
  return rewrite(value, PLACEHOLDER, AWS_MVP_PREFIX);
}

export function replaceLegacyMvpHost<T>(value: T): T {
  return rewrite(value, LEGACY_COS_MVP_PREFIX, AWS_MVP_PREFIX);
}

function rewrite<T>(value: T, from: string, to: string): T {
  if (typeof value === "string") return value.split(from).join(to) as T;
  if (Array.isArray(value)) return value.map((item) => rewrite(item, from, to)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewrite(item, from, to)])) as T;
  }
  return value;
}
