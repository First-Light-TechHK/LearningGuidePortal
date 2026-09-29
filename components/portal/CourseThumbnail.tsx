import Image from "next/image";

export function courseImageFor(slug: string) {
  const value = slug.toLowerCase();
  if (value.includes("epicure") || value.includes("poetry") || value.includes("literature") || value.includes("history")) return "/portal/course-book.jpg";
  return "/portal/course-study.jpg";
}

export function CourseThumbnail({ slug, title, src, className = "" }: { slug: string; title: string; src?: string | null; className?: string }) {
  const cover = src && !/[\\\s]/.test(src) && (/^\/(?!\/)/.test(src) || /^https:\/\//.test(src)) ? src : null;
  // Course media authorisation must run for the browser, not the public image cache.
  return <Image className={`course-thumbnail ${className}`.trim()} src={cover || courseImageFor(slug)} unoptimized={Boolean(cover)} referrerPolicy="no-referrer" alt={title} width={825} height={550} sizes="(max-width: 720px) 100vw, (max-width: 1100px) 50vw, 33vw" />;
}
