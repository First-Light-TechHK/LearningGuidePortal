import en from './lesson-authoring-en-GB.json';
import zh from './lesson-authoring-zh-CN.json';

export type LessonLocale = 'en-GB' | 'zh-CN';
export function lessonMessages(locale: LessonLocale) { return locale === 'zh-CN' ? zh : en; }
