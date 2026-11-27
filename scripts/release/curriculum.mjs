import { createHash } from 'node:crypto';

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

/**
 * Stored fields that carry no published content: every environment writes them
 * when the same course is authored or imported, so two environments holding the
 * same content still differ in these values.
 */
export function courseContent(course) {
  const { createdAt, updatedAt, revision, ...content } = course || {};
  return content;
}

export function mediaReferences(value) {
  const found = new Map();
  function visit(item, key = '') {
    if (Array.isArray(item)) return item.forEach(child => visit(child, key));
    if (item && typeof item === 'object') return Object.entries(item).forEach(([name, child]) => visit(child, name));
    if (typeof item !== 'string') return;
    for (const raw of item.match(/https?:\/\/[^\s<>"']+/g) || []) {
      const url = new URL(raw.replaceAll('&amp;', '&'));
      if (!/\.(mp4|webm|mov|m4v|mp3|wav|m4a|ogg|jpg|jpeg|png|webp|gif|pdf|glb|gltf)$/i.test(url.pathname) && !/^(url|src|cover|thumbnailPath|poster|audioUrl|videoUrl)$/.test(key)) continue;
      url.search = ''; url.hash = '';
      const kind = /\.(mp4|webm|mov|m4v)$/i.test(url.pathname) ? 'video' : /\.(mp3|wav|m4a|ogg)$/i.test(url.pathname) ? 'audio' : /\.pdf$/i.test(url.pathname) ? 'pdf' : /\.(glb|gltf)$/i.test(url.pathname) ? 'model3d' : 'image';
      found.set(url.href, { url: url.href, kind });
    }
  }
  visit(value);
  return [...found.values()].sort((a, b) => a.url.localeCompare(b.url));
}

export function curriculumManifest(product) {
  const courses = (product.courses || []).filter(course => course.status === 'published').map(course => ({
    id: course.id, slug: course.slug, title: course.title, category: course.category,
    cover: course.cover || course.thumbnailPath || null,
    // Hash all stored content fields. Timestamps and the draft-edit counter are
    // written independently in each environment (they differ by milliseconds for
    // the same content), so hashing them would report a false mismatch.
    revision: digest(courseContent(course)),
    media: mediaReferences(course),
    sections: (course.sections || []).filter(section => !section.archivedAt).map(section => ({
      id: section.id, title: section.title,
      lessons: (section.lessons || []).map(lesson => ({ id: lesson.id, title: lesson.title, isPublic: lesson.isPublic, bodyHash: digest(lesson.body || ''), contentsHash: digest(lesson.contents || []), media: mediaReferences(lesson), videoLimitSeconds: lesson.preview?.videoLimitSeconds ?? null }))
    }))
  })).sort((a, b) => a.id.localeCompare(b.id));
  return { version: 1, hash: digest(courses), courses };
}

export function compareCurricula(reference, target) {
  const failures = [];
  if (!reference.courses.length) failures.push('SIT reference contains no published courses');
  const expected = new Map(reference.courses.map(course => [course.id, course]));
  const actual = new Map(target.courses.map(course => [course.id, course]));
  for (const [id, course] of expected) {
    if (!actual.has(id)) failures.push(`Missing SIT course: ${id}`);
    else if (digest(course) !== digest(actual.get(id))) failures.push(`Course differs from SIT: ${id}`);
  }
  for (const id of actual.keys()) if (!expected.has(id)) failures.push(`Unexpected UAT course: ${id}`);
  return { ok: !failures.length, failures };
}
