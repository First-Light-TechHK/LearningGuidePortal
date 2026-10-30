"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { TutorChat } from "./TutorChat";
import { TutorDrawer } from "./TutorDrawer";
import { ExplorationDialog } from "./ExplorationDialog";
import { useEffect, useId, useRef, useState } from "react";
import type { LessonContent } from "@/contracts/lesson-content";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { lessonLearningModes, type previewLessonOutline } from "@/lib/previewLessonPresentation";
import { LessonContentPlayer, TrialLimitModal, type TrialGate } from "./LessonContentPlayer";
import { LessonCompletionBar } from "./LessonCompletionBar";
import type { VideoPlaybackProgress } from "@/contracts/video-progress";
import { canPromptVideoCompletion, videoCompletionPercent } from "@/lib/videoLessonCompletion";
import { PreviewProgress } from "./PreviewProgress";
import styles from "./preview-lesson.module.css";
import type { CourseLearningMode, CourseLearningModeResult } from "@/contracts/course-learning-mode";
import { resolveLessonPresentation, modeLessonDestination } from "@/lib/courseLearningMode";
import { TextLessonReader } from "./TextLessonReader";
import { TextLessonCompletion } from "./TextLessonCompletion";
import type { TextLessonPreview } from "@/contracts/text-lesson-preview";
import { textLessonPreviewPolicy } from "@/lib/textLessonPreview";
import type { AssessmentAvailability, LessonPreviewConfiguration } from "@/contracts/lesson-resources";
import type { ExplorationDisplay } from "@/contracts/exploration";

export function PreviewLessonView({ locale, courseId, courseTitle, category, description, lesson, outline, poster, trialGate, textPreview, initialCompleted, completedContentIds, nextHref, entitled, tutorOnline = true, preferredMode = null, initialContentId = null, studyEndpoint = "/api/study/preview", explorationData, assessmentAvailability }: {
  locale: Locale; courseId: string; courseTitle: string; category: string; description: string;
  lesson: { id: string; title: string; body: string; durationMinutes: number; contents?: LessonContent[]; preview?: LessonPreviewConfiguration };
  explorationData?: ExplorationDisplay; assessmentAvailability?: AssessmentAvailability;
  outline: ReturnType<typeof previewLessonOutline>; poster: string; trialGate?: TrialGate;
  textPreview?: TextLessonPreview;
  initialCompleted: boolean; completedContentIds?: string[]; nextHref: string | null; entitled: boolean;
  /** KS 课程级 Online 状态；false 时隐藏「询问 AI 导师」入口（2026-10-22）；页面必须显式传入 */
  tutorOnline?: boolean;
  preferredMode?: CourseLearningMode | null;
  initialContentId?: string | null;
  studyEndpoint?: "/api/study/preview" | "/api/study/events";
}) {
  const pageRef = useRef<HTMLDivElement>(null);
  const toolId = useId();
  const router = useRouter();
  const [exploreOpen, setExploreOpen] = useState(false);
  const [tutorOpen, setTutorOpen] = useState(false);
  const [accessPlanOpen, setAccessPlanOpen] = useState(false);
  const [exhibitContainer, setExhibitContainer] = useState<HTMLDivElement | null>(null);
  function openExploration() { pageRef.current?.querySelectorAll<HTMLMediaElement>("video,audio").forEach(media => media.pause()); setExploreOpen(true); }
  const messages = getMessages(locale), copy = messages.previewVideoDesign;
  const contents = (lesson.contents || []).filter(content => content.active !== false);
  const presentation = resolveLessonPresentation(contents, preferredMode, initialContentId);
  const [contentId, setContentId] = useState(presentation.contentId);
  const [videoProgress, setVideoProgress] = useState<VideoPlaybackProgress | null>(null);
  const [ended, setEnded] = useState<{ contentId: string; request: number } | null>(null);
  const [nodeRequest, setNodeRequest] = useState<{ id: string; request: number }>();
  const [textNavigation, setTextNavigation] = useState<{ id: string; request: number }>();
  const [videoNavigation, setVideoNavigation] = useState<{ id: string; request: number }>();
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [modeSaving, setModeSaving] = useState(false), [modeError, setModeError] = useState("");
  const modeSaveLock = useRef(false);
  const modeMounted = useRef(true);
  useEffect(() => { modeMounted.current = true;return () => { modeMounted.current = false; }; }, []);
  const selected = contents.find(content => content.id === contentId);
  useEffect(() => { setPlayingId(null); }, [lesson.id]);
  const mode: CourseLearningMode = selected?.type === "video" ? "video" : "text";
  const textPolicy = !entitled && mode === "text" ? textPreview || textLessonPreviewPolicy(contents, lesson.preview) : undefined;
  const textLocked = Boolean(selected && textPolicy?.points[selected.id] === "locked");
  const textEnd = Boolean(textPolicy);
  useEffect(() => { setAccessPlanOpen(false); }, [lesson.id, mode, entitled]);
  useEffect(() => { if (!tutorOnline) setTutorOpen(false); }, [tutorOnline]);
  useEffect(() => {
    pageRef.current?.querySelectorAll<HTMLMediaElement>("video,audio").forEach(media => media.pause());
    setContentId(presentation.contentId);
    setTextNavigation(undefined);
    setVideoNavigation(undefined);
    setNodeRequest(undefined);
    setVideoProgress(null);
    setEnded(null);
  }, [lesson.id, preferredMode, initialContentId, presentation.contentId]);
  const hasMultipleModes = new Set([...outline.flatMap(item => item.modes || []), ...lessonLearningModes(lesson)]).size > 1;
  const filteredOutline = outline.filter(item => !item.modes || item.modes.includes(mode));
  const videoContent = contents.find(content => content.type === "video");
  const textContent = contents.find(content => content.type === "text" || content.type === "pdf");
  async function switchMode(mode: CourseLearningMode) {
    if (modeSaveLock.current) return;
    const content = mode === "video" ? videoContent : textContent;
    const currentHasMode=Boolean(content) || (mode==="text" && !contents.length && Boolean(lesson.body?.trim()));
    if(!modeLessonDestination(outline,lesson.id,mode,currentHasMode,content?.id))return;
    modeSaveLock.current = true;setModeSaving(true);setModeError("");
    pageRef.current?.querySelectorAll<HTMLMediaElement>("video,audio").forEach(media => media.pause());
    try {
      const response = await fetch(`/api/courses/${encodeURIComponent(courseId)}/learning-mode`, { method: "PUT", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, lessonId: lesson.id }) });
      const result = await response.json() as { ok: boolean; data?: CourseLearningModeResult };
      if (!response.ok || !result.ok) throw new Error("mode-save");
      if (!modeMounted.current) return;
      const destination = modeLessonDestination(outline,lesson.id,mode,currentHasMode,content?.id,result.data?.position);
      if (!destination) throw new Error("mode-destination");
      setNodeRequest(undefined);
      setVideoProgress(null);
      setEnded(null);
      if(destination.lessonId===lesson.id) {
        const targetId = result.data?.position?.lessonId === lesson.id ? result.data.position.contentId || "" : content?.id || "";
        setContentId(targetId);
        setTextNavigation(mode === "text" && targetId ? { id: targetId, request: Date.now() } : undefined);
      }
      setVideoNavigation(undefined);
      setPlayingId(null);
      router.push(destination.href);
    } catch { if (modeMounted.current) setModeError(messages.courseLearningMode.saveError); }
    finally { modeSaveLock.current = false;if (modeMounted.current) setModeSaving(false); }
  }
  const current = outline.find(item => item.id === lesson.id);
  const courseHref = `/${locale}/portal/courses/${courseId}`;
  const pricingHref = trialGate?.pricingHref || `/${locale}/subscription?courseId=${encodeURIComponent(courseId)}`;
  async function chooseAccessPlan() {
    if (entitled) return;
    pageRef.current?.querySelectorAll<HTMLMediaElement>("video,audio").forEach(media => media.pause());
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
    setAccessPlanOpen(true);
  }
  const tools = [
    ...(tutorOnline ? [{ icon: "tutor", title: copy.tutor, action: "tutor" }] : []),
    { icon: "understanding", title: copy.understanding, href: entitled ? `/${locale}/portal/courses/${encodeURIComponent(courseId)}/understanding?lessonId=${encodeURIComponent(lesson.id)}${studyEndpoint === "/api/study/preview" ? "&from=preview" : ""}` : undefined },
    { icon: "explore", title: copy.explore, action: "explore" },
  ];
  return <div ref={pageRef} className={styles.page} data-course-id={courseId} data-lesson-id={lesson.id}>
    <nav className={styles.breadcrumb} aria-label={messages.courseDetailDesign.breadcrumb}>
      <Link href={`/${locale}/portal/courses`}>{messages.portal.navigation.courses}</Link><span aria-hidden="true">/</span>
      {category && <><Link href={`/${locale}/portal/courses?category=${encodeURIComponent(category)}`}>{category}</Link><span aria-hidden="true">/</span></>}
      <Link href={courseHref}>{courseTitle}</Link>
      <span aria-hidden="true">/</span><span aria-current="page">{messages.courseDetailDesign.lesson}</span>
    </nav>
    <div className={`${styles.layout} ${mode === "text" ? styles.textLayout : ""}`}>
      <aside className={styles.sidebar}>
        <h2>{courseTitle}</h2>
        <div className={styles.modeControl}>{hasMultipleModes ? <><select className={styles.modeSwitch} aria-label={copy.learningMode} value={mode} disabled={modeSaving} onChange={event => void switchMode(event.target.value as CourseLearningMode)}>
          <option value="video" disabled={!modeLessonDestination(outline, lesson.id, "video", Boolean(videoContent))}>{copy.videoMode}</option>
          <option value="text" disabled={!modeLessonDestination(outline, lesson.id, "text", Boolean(textContent) || (!contents.length && Boolean(lesson.body?.trim())))}>{copy.textMode}</option>
        </select><Image src="/portal/learning-mode/dropdown.svg" alt="" width={10.3923} height={9} /></> : <span className={`${styles.modeSwitch} ${styles.fixedMode}`} data-learning-mode={mode}>{mode === "video" ? copy.videoMode : copy.textMode}</span>}</div>
        {modeError && <p className={styles.modeError} role="alert">{modeError}</p>}
        <nav aria-label={copy.outline} className={styles.outline}>
          {filteredOutline.map(item => <div key={item.id} className={`${styles.lesson} ${item.id === lesson.id ? styles.activeLesson : ""} ${!item.href ? styles.lockedLesson : ""}`}>
            {item.href ? <Link className={styles.lessonLink} aria-current={item.id === lesson.id ? "page" : undefined} href={`${item.href}${item.href.includes("?") ? "&" : "?"}viewMode=${mode}`}><span>{item.number}</span>{item.title}</Link> : <span className={styles.lessonLink} aria-disabled="true"><span>{item.number}</span>{item.title}</span>}
            {item.id === lesson.id && contents.length > 0 && <div className={styles.contentLinks}>{contents.filter(content => mode === "video" ? content.type === "video" : content.type === "text" || content.type === "pdf").map((content, modeIndex) => <button key={content.id} type="button" aria-current={content.id === contentId ? "step" : undefined} onClick={() => { if (mode === "text") setTextNavigation(previous => ({ id: content.id, request: (previous?.request || 0) + 1 })); else { setContentId(content.id); setVideoNavigation(previous => ({ id: content.id, request: (previous?.request || 0) + 1 })); } setNodeRequest(undefined); }}>{Number(item.number)}.{modeIndex + 1} {content.title}</button>)}</div>}
          </div>)}
          {!filteredOutline.length && <p className={styles.emptyOutline} role="status">{copy.noLessonsInMode}</p>}
        </nav>
      </aside>
      <article className={styles.main}>
        <header className={styles.heading}><p>{current?.number}</p><h1>{lesson.title}</h1>{!entitled && <button type="button" className={styles.chooseAccess} aria-haspopup="dialog" aria-expanded={accessPlanOpen} onClick={() => void chooseAccessPlan()}>{messages.previewAccess.choosePlan}</button>}{selected?.type === "video" && entitled && <LessonCompletionBar assessmentAvailability={assessmentAvailability} lessonTitle={lesson.title} key={`${lesson.id}:${selected.id}`} contentId={selected.id} visible={canPromptVideoCompletion(entitled, selected.id, videoProgress)} endedRequest={ended?.contentId === selected.id ? ended.request : 0} locale={locale} courseId={courseId} lessonId={lesson.id} lessonNumber={current?.number || "01"} percentage={videoCompletionPercent(videoProgress) || 0} seconds={Math.floor(videoProgress?.currentTime || 0)} initialCompleted={completedContentIds ? completedContentIds.includes(selected.id) : initialCompleted} nextHref={nextHref} endpoint={studyEndpoint}/>}<div className={styles.introduction}>{description}</div><Image className={styles.headingDivider} src="/portal/study/divider.svg" alt="" width={940} height={1}/></header>
        <div className={styles.mediaRow}>
          {mode === "text" ? <TextLessonReader key={`${lesson.id}:text`} className={`${styles.player} ${styles.textPlayer}`} label={copy.textMode} contents={contents} body={lesson.body} locale={locale} lessonNumber={current?.number || "01"} initialContentId={presentation.mode === "text" ? presentation.contentId : textContent?.id || ""} navigationRequest={textNavigation} onContentChange={setContentId} preview={textPolicy} previewEnd={textEnd ? <div className={styles.previewEnd} data-text-preview-end><div className={styles.lockedText} aria-hidden="true">{Array.from({ length: 7 }, (_, index) => <span key={index}/>)}</div><div className={styles.previewFade}/><section className={styles.previewNotice} aria-label={messages.previewAccess.previewEnds}><h2><Image src="/portal/text-preview/lock.svg" alt="" width={16} height={16}/>{messages.previewAccess.previewEnds}</h2><button type="button" className={styles.chooseAccess} aria-haspopup="dialog" aria-expanded={accessPlanOpen} onClick={() => void chooseAccessPlan()}>{messages.previewAccess.choosePlan}</button></section></div> : undefined}/> : <div className={styles.player} key={`${lesson.id}:video`}>
            <LessonContentPlayer videoNavigationRequest={videoNavigation} exhibitContainer={exhibitContainer} contents={contents} locale={locale} fallbackImageUrl="/portal/exh.jpg" trialGate={entitled ? undefined : trialGate} onPreviewAccess={!entitled ? () => void chooseAccessPlan() : undefined} selectedContentId={contentId} onContentChange={setContentId} hideNavigation nodeRequest={nodeRequest} onVideoStart={setPlayingId} onVideoProgress={setVideoProgress} onVideoEnded={progress => setEnded(previous => ({ contentId: progress.contentId, request: (previous?.request || 0) + 1 }))} videoPresentation={{ poster, playLabel: copy.play }} />
          </div>}
          {entitled && <TextLessonCompletion assessmentAvailability={assessmentAvailability} key={lesson.id} visible={mode === "text"} locale={locale} courseId={courseId} lessonId={lesson.id} lessonNumber={current?.number || "01"} lessonTitle={lesson.title} nextHref={nextHref} endpoint={studyEndpoint}/>}
          <aside className={styles.tools} aria-label={copy.deepLearning} tabIndex={!entitled ? 0 : undefined} aria-describedby={!entitled ? toolId : undefined}><h2>{copy.deepLearning}</h2>
            {tools.map(tool => {
              const body = <><span className={styles.toolIcon} aria-hidden="true"><Image src={`/portal/study/${tool.icon}.svg`} alt="" width={16} height={16}/></span><span className={styles.toolLabel}>{tool.title}</span></>;
              return <div key={tool.icon} className={styles.toolItem}>
                {tool.href ? <Link className={styles.tool} href={tool.href}>{body}</Link> : <button type="button" className={styles.tool} disabled={!entitled} aria-expanded={tool.action === "tutor" ? tutorOpen : undefined} onClick={tool.action === "tutor" ? () => setTutorOpen(value => !value) : openExploration}>{body}</button>}
              </div>;
            })}
            {!entitled && <span id={toolId} className={styles.toolTooltip} role="tooltip">{copy.includedWithFullAccess}</span>}
            <div ref={setExhibitContainer} className={styles.exhibitSlot}/>
          </aside>
        </div>
        {tutorOpen && entitled && tutorOnline && <TutorDrawer onClose={() => setTutorOpen(false)}><TutorChat locale={locale} courseId={courseId} lessonId={lesson.id} copy={messages.learning} onClose={() => setTutorOpen(false)}/></TutorDrawer>}
        <div className={styles.progress}>
          <PreviewProgress enabled={!textLocked && (mode !== "video" || playingId === selected?.id)} showError={mode !== "video"} endpoint={studyEndpoint} courseId={courseId} lessonId={lesson.id} contentId={selected?.id || null} learningMode={selected ? selected.type === "video" ? "video" : "text" : !contents.length && lesson.body?.trim() ? "text" : undefined} seconds={lesson.durationMinutes * 60} initialCompleted={initialCompleted} canComplete={false} copy={{ ...messages.learning, saveError: messages.overviewDesign.previewSaveError }} />
        </div>
      </article>
    </div>
    {exploreOpen && <ExplorationDialog data={explorationData} lessons={outline.map(lesson=>({number:lesson.number,title:lesson.title,unlocked:Boolean(lesson.href)}))} locale={locale} courseId={courseId} lessonNumber={current?.number || "01"} tutorAvailable={tutorOnline} onClose={() => setExploreOpen(false)} onAskTutor={() => { setExploreOpen(false); setTutorOpen(true); }}/> }
    {accessPlanOpen && !entitled && <TrialLimitModal gate={trialGate || { pricingHref, recommendations: [] }} locale={locale} onClose={() => setAccessPlanOpen(false)} />}
  </div>;
}
