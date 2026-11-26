import type { PortalCategory } from '@/lib/portalContent';

export function catalogueCategories(categories: PortalCategory[], courses: { category?: string; origin?: string }[], adminMode: boolean) {
  if (!adminMode || !courses.some(course => course.origin === 'admin' && course.category === 'Society')) return categories;
  if (categories.some(category => (category.id as string) === 'Society')) return categories;
  return [...categories, { id: 'Society' as const, labels: { 'en-GB': 'Society', 'zh-CN': '社会' } }];
}
