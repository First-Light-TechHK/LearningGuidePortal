import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveLessonEntry } from "../../services/lessonEntryPolicy";
import { lessonLanguageHref } from "../../lib/lessonLanguageNavigation";
import type { LessonBookmarkSnapshot } from "../../contracts/lesson-bookmark";

const snapshot: LessonBookmarkSnapshot = { versions: { lesson: { video: 'v', text: 't' } }, bookmarks: { lesson: {
  video: { mode: 'video', contentId: 'v2', contentVersion: 'v', positionMs: 12345, revision: 1, clientEventId: 'v', updatedAt: '2026-01-02', lpNumber: '1.2' },
  text: { mode: 'text', contentId: 't2', contentVersion: 't', paragraphId: 't2:paragraph:5', revision: 1, clientEventId: 't', updatedAt: '2026-01-01', lpNumber: '1.2' },
} } };
test('Lesson entry selects latest unfinished mode, starts new/completed Lessons and continues across languages', () => {
  const input = { lessonId: 'lesson', snapshot, completed: false, courseMode: 'text' as const };
  assert.deepEqual(resolveLessonEntry(input), { preferredMode: 'video', initialContentId: 'v2', bookmarkRestore: 'lp' });
  assert.equal(resolveLessonEntry({ ...input, requestedMode: 'text' }).preferredMode, 'video', 'stale URL cannot select an older mode');
  assert.deepEqual(resolveLessonEntry({ ...input, completed: true }), { preferredMode: 'text', initialContentId: null, bookmarkRestore: 'start' });
  assert.deepEqual(resolveLessonEntry({ ...input, lessonId: 'new' }), { preferredMode: 'text', initialContentId: null, bookmarkRestore: 'start' });
  assert.equal(resolveLessonEntry({ ...input, completed: true, languageContinuation: true }).initialContentId, 'v2');
  for(const completed of [false,true]) assert.deepEqual(resolveLessonEntry({...input,completed,languageContinuation:true,requestedMode:'text'}),{preferredMode:'text',initialContentId:'t2',bookmarkRestore:'lp'},'language continuation uses the current mode even when another mode has a newer bookmark');
  assert.equal(resolveLessonEntry({ ...input, requestedMode: 'text', switchingMode: true }).initialContentId, 't2');
  assert.equal(resolveLessonEntry({ ...input, snapshot: { ...snapshot, versions: { lesson: {} } } }).bookmarkRestore, 'start');
});
test('language continuation removes stale mode/cursor parameters and retains the Lesson and other query data', () => {
  for (const prefix of ['/account/learn/course', '/portal/courses/course/public-lesson']) {
    const link = lessonLanguageHref('/en-GB' + prefix, 'lessonId=lesson&viewMode=text&contentId=old&modeSwitch=1&foo=bar', 'zh-CN');
    assert.equal(link.lesson, true);
    assert.equal(link.href, '/zh-CN' + prefix + '?lessonId=lesson&foo=bar&resume=1');
  }
  assert.equal(lessonLanguageHref('/zh-CN/subscription', 'planId=p', 'en-GB').href, '/en-GB/subscription?planId=p');
});
