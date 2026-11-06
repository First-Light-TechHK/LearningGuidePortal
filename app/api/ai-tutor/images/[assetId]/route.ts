import { currentProductUser } from "@/services/productAuth";
import { checkEntitlement, getProductCourse } from "@/services/productStore";
import { getTutorAvailability, getTutorImage } from "@/services/ksTutorClient";

const ASSET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|gif|webp)$/i;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export async function GET(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const user = await currentProductUser();
  if (!user) return new Response(null, { status: 401 });
  const { assetId } = await params;
  if (!ASSET_ID.test(assetId)) return new Response(null, { status: 400 });
  const courseId = new URL(request.url).searchParams.get("courseId") || "";
  const course = await getProductCourse(courseId);
  if (!course || course.status !== "published") return new Response(null, { status: 404 });
  if (!(await checkEntitlement(user.id, course.id)).allowed) return new Response(null, { status: 403 });
  const availability = await getTutorAvailability(course.slug, request.signal);
  if (!availability.online) return new Response(null, { status: 403 });
  try {
    const upstream = await getTutorImage(course.slug, assetId);
    const contentType = upstream.headers.get("content-type")?.split(";")[0] || "";
    if (!upstream.ok || !IMAGE_TYPES.has(contentType)) return new Response(null, { status: 404 });
    const bytes = await upstream.arrayBuffer();
    if (bytes.byteLength > 5 * 1024 * 1024) return new Response(null, { status: 502 });
    return new Response(bytes, { headers: { "Content-Type": contentType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return new Response(null, { status: 502 });
  }
}
