/** Test double so a page can render when the assertion is not about signing. */
export async function signCourseMediaUrl(value: string) {
  return value;
}

export function toS3Key(relativePath: string) {
  return relativePath.replace(/^\/+/, "");
}

export async function s3Put() {
  return "";
}

export async function s3Get() {
  return Buffer.alloc(0);
}

export async function s3Delete() {
  return undefined;
}

export async function s3DeleteMany() {
  return undefined;
}
