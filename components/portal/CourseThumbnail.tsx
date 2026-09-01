import Image from "next/image";

export function courseImageFor(slug: string) {
  const value = slug.toLowerCase();
  if (value.includes("epicure") || value.includes("poetry") || value.includes("literature") || value.includes("history")) return "/portal/course-book.jpg";
  return "/portal/course-study.jpg";
}

export function CourseThumbnail({ slug, title, className = "" }: { slug: string; title: string; className?: string }) {
  return <Image className={`course-thumbnail ${className}`.trim()} src={courseImageFor(slug)} alt="" width={825} height={550} sizes="(max-width: 720px) 100vw, (max-width: 1100px) 50vw, 33vw" />;
}
