import { DeleteObjectCommand, DeleteObjectsCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { awsRegion, dataS3Bucket, dataS3Prefix } from "./config";

let client: S3Client | null = null;

function getClient() {
  if (!client) {
    client = new S3Client({ region: awsRegion() });
  }
  return client;
}

export function toS3Key(relativePath: string) {
  const cleaned = relativePath.replace(/^\/+/, "");
  return `${dataS3Prefix()}/${cleaned}`;
}

export async function s3Put(relativePath: string, body: Buffer, contentType: string) {
  const Key = toS3Key(relativePath);
  await getClient().send(
    new PutObjectCommand({
      Bucket: dataS3Bucket(),
      Key,
      Body: body,
      ContentType: contentType
    })
  );
  return Key;
}

export async function s3Get(s3Key: string) {
  const response = await getClient().send(
    new GetObjectCommand({
      Bucket: dataS3Bucket(),
      Key: s3Key
    })
  );
  const bytes = await response.Body?.transformToByteArray();
  if (!bytes) throw new Error(`S3 object empty: ${s3Key}`);
  return Buffer.from(bytes);
}

const COURSE_MEDIA_HOST = "aitutor-data-851987565851.s3.ap-southeast-1.amazonaws.com";
const COURSE_MEDIA_PREFIX = "/learning-guide/dev/documents/mvp/";

/** Convert an approved migrated course-media URL into a short-lived private URL. */
export async function signCourseMediaUrl(value: string, expiresIn = 300) {
  let parsed: URL;
  try { parsed = new URL(value); } catch { return value; }
  if (parsed.protocol !== "https:" || parsed.host !== COURSE_MEDIA_HOST || !parsed.pathname.startsWith(COURSE_MEDIA_PREFIX)) return value;
  // URL.pathname retains percent escapes. Decode them once so the S3 SDK signs
  // the actual UTF-8 object key instead of double-encoding "%" as "%25".
  let key: string;
  try { key = decodeURIComponent(parsed.pathname.slice(1)); } catch { return value; }
  return getSignedUrl(getClient(), new GetObjectCommand({ Bucket: COURSE_MEDIA_HOST.split(".")[0], Key: key }), { expiresIn });
}

export async function s3Delete(s3Key: string) {
  await getClient().send(
    new DeleteObjectCommand({
      Bucket: dataS3Bucket(),
      Key: s3Key
    })
  );
}

export async function s3DeleteMany(s3Keys: string[]) {
  if (!s3Keys.length) return;
  for (let i = 0; i < s3Keys.length; i += 1000) {
    const chunk = s3Keys.slice(i, i + 1000);
    await getClient().send(
      new DeleteObjectsCommand({
        Bucket: dataS3Bucket(),
        Delete: {
          Objects: chunk.map((Key) => ({ Key })),
          Quiet: true
        }
      })
    );
  }
}
