import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogueCategories } from '@/lib/catalogueCategories';
import { defaultPortalContent } from '@/lib/portalContent';

test('Society appears only for an admin-sourced Society course', () => {
  const categories = defaultPortalContent.categories;
  assert.deepEqual(catalogueCategories(categories, [{ category: 'Society', origin: 'admin' }], false), categories);
  assert.deepEqual(catalogueCategories(categories, [{ category: 'Science', origin: 'admin' }], true), categories);
  assert.deepEqual(catalogueCategories(categories, [{ category: 'Society' }], true), categories);
  assert.equal(catalogueCategories(categories, [{ category: 'Society', origin: 'admin' }], true).at(-1)?.labels['zh-CN'], '社会');
});
