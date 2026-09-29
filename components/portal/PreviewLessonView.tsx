"use client";

import Link from "next/link";
import { useState } from "react";
import type { LessonContent } from "@/contracts/lesson-content";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import type { previewLessonOutline } from "@/lib/previewLessonPresentation";
import { LegacyLessonBody, LessonContentPlayer, type TrialGate } from "./LessonContentPlayer";
import { PreviewProgress } from "./PreviewProgress";
import styles from "./preview-lesson.module.css";

export function PreviewLessonView({ locale, courseId, courseTitle, category, description, lesson, outline, poster, trialGate, initialCompleted, nextHref, entitled }: {
  locale: Locale; courseId: string; courseTitle: string; category: string; description: string;
  lesson: { id: string; title: string; body: string; durationMinutes: number; contents?: LessonContent[] };
  outline: ReturnType<typeof previewLessonOutline>; poster: string; trialGate?: TrialGate;
  initialCompleted: boolean; nextHref: string | null; entitled: boolean;
}) {
  const messages = getMessages(locale), copy = messages.previewVideoDesign;
  const contents = (lesson.contents || []).filter(content => content.active !== false);
  const [contentId, setContentId] = useState(contents.find(content => content.type === "video")?.id || contents[0]?.id || "");
  const [nodeRequest, setNodeRequest] = useState<{ id: string; request: number }>();
  const selected = contents.find(content => content.id === contentId);
  const current = outline.find(item => item.id === lesson.id);
  const previewMinutes = Math.ceil((trialGate?.videoLimitSeconds ?? 60) / 60);
  const previewBadge = previewMinutes === 1 ? copy.previewBadgeOne : copy.previewBadge.replace("{minutes}", String(previewMinutes));
  const courseHref = `/${locale}/portal/courses/${courseId}`;
  const pricingHref = trialGate?.pricingHref || `/${locale}/pricing?courseId=${encodeURIComponent(courseId)}`;
  const learningHref = `/${locale}/account/learn/${courseId}?lessonId=${encodeURIComponent(lesson.id)}`;
  const exercise = selected?.nodes.find(node => node.active !== false && node.type === "exercise");
  const exhibit = selected?.nodes.find(node => node.active !== false && node.type !== "exercise");
  const tools = [
    { icon: "AI", title: copy.tutor, body: copy.tutorDescription, href: entitled ? learningHref : undefined },
    { icon: "✓", title: copy.understanding, body: copy.understandingDescription, node: exercise },
    { icon: "↗", title: copy.explore, body: copy.exploreDescription, node: exhibit },
  ];
  return <div className={styles.page}>
    <nav className={styles.breadcrumb} aria-label={messages.courseDetailDesign.breadcrumb}>
      <Link href={`/${locale}/portal/courses`}>{messages.portal.navigation.courses}</Link><span aria-hidden="true">/</span>
      {category && <><Link href={`/${locale}/portal/courses?category=${encodeURIComponent(category)}`}>{category}</Link><span aria-hidden="true">/</span></>}
      <Link href={courseHref}>{courseTitle}</Link>
    </nav>
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <Link className={styles.back} href={courseHref}>← {copy.back}</Link>
        <h2>{courseTitle}</h2><p className={styles.outlineLabel}>{copy.outline}</p>
        <nav aria-label={copy.outline} className={styles.outline}>
          {outline.map(item => <div key={item.id} className={`${styles.lesson} ${item.id === lesson.id ? styles.activeLesson : ""} ${!item.href ? styles.lockedLesson : ""}`}>
            {item.href ? <Link className={styles.lessonLink} aria-current={item.id === lesson.id ? "page" : undefined} href={item.href}><span>{item.number}</span>{item.title}</Link> : <span className={styles.lessonLink} aria-disabled="true"><span>{item.number}</span>{item.title}</span>}
            {item.id === lesson.id && contents.length > 0 && <div className={styles.contentLinks}>{contents.map((content, index) => <button key={content.id} type="button" aria-current={content.id === contentId ? "step" : undefined} onClick={() => { setContentId(content.id); setNodeRequest(undefined); }}>{Number(item.number)}.{index + 1} {content.title}</button>)}</div>}
          </div>)}
        </nav>
      </aside>
      <article className={styles.main}>
        <header className={styles.heading}><p>{current?.number}</p><h1>{lesson.title}</h1><div>{description}</div></header>
        <div className={styles.mediaRow}>
          <div className={styles.player}>
            {contents.length ? <LessonContentPlayer contents={contents} locale={locale} fallbackImageUrl="/portal/exh.jpg" trialGate={trialGate} selectedContentId={contentId} onContentChange={setContentId} hideNavigation nodeRequest={nodeRequest} videoPresentation={{ poster, badge: trialGate ? previewBadge : undefined, playLabel: copy.play }} /> : <LegacyLessonBody body={lesson.body} locale={locale} />}
          </div>
          <aside className={styles.tools} aria-label={copy.deepLearning}><h2>{copy.deepLearning}</h2><p>{copy.toolsDescription}</p>
            {tools.map(tool => {
              const body = <><span className={styles.toolIcon} aria-hidden="true">{tool.icon}</span><span><strong>{tool.title}</strong><small>{tool.body}</small></span><span className={styles.toolArrow} aria-hidden="true">→</span></>;
              return tool.href ? <Link key={tool.title} className={styles.tool} href={tool.href}>{body}</Link> : <button key={tool.title} type="button" className={styles.tool} disabled={!entitled || !tool.node} onClick={() => tool.node && setNodeRequest({ id: tool.node.id, request: Date.now() })}>{body}</button>;
            })}
          </aside>
        </div>
        <section className={styles.banner}><div><p>{courseTitle}</p><h2>{copy.valueTitle}</h2><span>{copy.valueDescription}</span></div><Link className={styles.unlock} href={entitled ? learningHref : pricingHref}>{entitled ? messages.learning.continue : copy.unlock}</Link></section>
        <div className={styles.progress}>
          {entitled ? <PreviewProgress courseId={courseId} lessonId={lesson.id} seconds={lesson.durationMinutes * 60} initialCompleted={initialCompleted} copy={{ ...messages.learning, saveError: messages.overviewDesign.previewSaveError }} /> : null}
          {nextHref && <Link href={nextHref}>{messages.overviewDesign.continuePreview} →</Link>}
        </div>
      </article>
    </div>
  </div>;
}
