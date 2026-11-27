import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sanitiseLessonContents, validateLessonContents } from '../../services/lessonContent';
import type { LessonContent } from '../../contracts/lesson-content';
import { buildTextLessonPreview } from '../../services/textLessonPreview';

const adminId = '406ba000-0000-4000-a000-000000000025';
const otherId = '406ba000-0000-4000-a000-000000000026';
const url = `/api/admin-course-media/${adminId}/assets/2c55bd9f-1130-4fe9-8d8c-30e71a5c47de`;
const contents: LessonContent[] = [{id:'content-1',title:'Video',type:'video',mode:'lecture',url,nodes:[]}];
const mirror = {origin:'admin' as const,adminCourseId:adminId};

test('mirror media survives preview and entitled read, while writes and other courses reject it', () => {
  assert.equal(buildTextLessonPreview({body:'',contents},'course-slug',false,mirror).contents[0]?.url,url);
  assert.equal(buildTextLessonPreview({body:'',contents},'course-slug',true,mirror).contents[0]?.url,url);
  assert.equal(sanitiseLessonContents(contents,'course-slug',mirror)[0]?.url,url);
  assert.deepEqual(sanitiseLessonContents(contents,'course-slug'),[]);
  assert.deepEqual(sanitiseLessonContents(contents,'course-slug',{origin:'local',adminCourseId:adminId}),[]);
  assert.deepEqual(sanitiseLessonContents(contents,'course-slug',{origin:'admin',adminCourseId:otherId}),[]);
  assert.deepEqual(sanitiseLessonContents([{...contents[0],url:url+'?x=1'}],'course-slug',mirror),[]);
  assert.throws(() => validateLessonContents(contents,'course-slug'));
});
