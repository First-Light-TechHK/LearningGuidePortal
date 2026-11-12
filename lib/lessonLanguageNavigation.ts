export const lessonLanguageSaveEvent = "learning-guide:save-before-language";
export type LessonLanguageSave = { waitUntil: (save: Promise<void>) => void; setMode: (mode: "video" | "text") => void };

export async function saveBeforeLessonLanguageChange() {
  const pending: Promise<void>[] = [];
  let mode: "video" | "text" | undefined;
  window.dispatchEvent(new CustomEvent<LessonLanguageSave>(lessonLanguageSaveEvent, { detail: { waitUntil: save => pending.push(save), setMode: value => { mode = value; } } }));
  await Promise.all(pending);
  return mode;
}

export function lessonLanguageHref(pathname: string, query: string, locale: string) {
  const path = pathname.replace(/^\/(en-GB|zh-CN)(?=\/|$)/, `/${locale}`);
  const params = new URLSearchParams(query);
  const lesson = /\/(?:account\/learn\/[^/]+|portal\/courses\/[^/]+\/public-lesson)$/.test(pathname);
  if (lesson) {
    params.set("resume", "1");
    params.delete("viewMode");
    params.delete("contentId");
    params.delete("modeSwitch");
  }
  return { href: path + (params.size ? `?${params}` : ""), lesson };
}
