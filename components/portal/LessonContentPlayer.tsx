"use client";
import type { VideoPlaybackProgress } from "@/contracts/video-progress";

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, CheckCircle2, X } from 'lucide-react';
import type { LessonContent, LessonNode } from '@/contracts/lesson-content';
import { lessonMessages, type LessonLocale } from '@/messages/lesson-authoring';
import { CourseMediaPreview, LessonModal, SafeLessonHtml, safeMediaUrl } from './CourseMediaPreview';
import './lesson-authoring.css';
import { ControlledVideo } from './ControlledVideo';
import { VideoExhibitBar } from './VideoExhibitBar';
import { ExhibitDialog } from './ExhibitDialog';
import { TextExhibitContent } from './TextExhibitContent';
import { dueVideoNodes } from '@/lib/videoExhibitPrompt';
import { videoExhibitNodes } from '@/lib/videoExhibitSamples';
import { playbackDuration } from '@/lib/videoLessonCompletion';
import { getMessages } from '@/lib/i18n/messages';
import { PortalDialog } from './PortalDialog';

type TrialRecommendation = { title: string; href: string; image?: string | null; category?: string | null };
export type TrialGate = { pricingHref: string; recommendations: TrialRecommendation[]; videoLimitSeconds?: number };

export function TrialLimitModal({ gate, locale, onClose }: { gate: TrialGate; locale: LessonLocale; onClose: () => void }) {
  const copy = getMessages(locale).previewAccess;
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => { setTarget(document.body); }, []);
  return target ? createPortal(<PortalDialog className="la-trial-modal" labelledBy="la-trial-title" describedBy="la-trial-description" onClose={onClose}>
      <button type="button" className="la-trial-close" aria-label={copy.close} onClick={onClose}><X size={24} aria-hidden="true" /></button>
      <div className="la-trial-upgrade">
        <h3 id="la-trial-title">{copy.heroTitle}</h3>
        <p id="la-trial-description">{copy.heroBody}</p>
        <ul>{copy.bullets.map(item => <li key={item}><CheckCircle2 size={16} aria-hidden="true" />{item}</li>)}</ul>
      </div>
      <div className="la-trial-related">
        <strong>{copy.other}</strong>
        <div className="la-trial-course-list">{gate.recommendations.length ? gate.recommendations.slice(0, 2).map((course, index) => <a className="la-trial-course" href={course.href} key={course.href}>
          {course.image ? <img src={course.image} alt=""/> : <span className={`la-trial-course-placeholder la-trial-course-placeholder-${index + 1}`} aria-hidden="true"/>}
          <span><b>{course.title}</b><small>{copy.relatedBody}</small><em>{copy.viewCourse}<ArrowRight size={15} aria-hidden="true" /></em></span>
        </a>) : <p className="la-trial-empty">{copy.empty}</p>}</div>
      </div>
      <a className="la-trial-pricing" href={gate.pricingHref}>{copy.cta}</a>
  </PortalDialog>, target) : null;
}

function Exercise({ node, locale }: { node: LessonNode; locale: LessonLocale }) {
  const t = lessonMessages(locale), [revealed, setRevealed] = useState(false), [answer, setAnswer] = useState(''), [selected, setSelected] = useState<number[]>([]);
  const correct = node.correctOptions || [], multiple = correct.length > 1;
  const isCorrect = node.options?.length ? selected.length === correct.length && selected.every(index => correct.includes(index)) : answer.trim().toLocaleLowerCase() === node.answer?.trim().toLocaleLowerCase();
  return <div className="la-exercise"><p>{node.question || node.title}</p>
    {node.options?.length ? <fieldset><legend>{t.yourAnswer}</legend>{node.options.map((option, index) => <label className={`la-option ${revealed && correct.includes(index) ? 'la-correct' : ''}`} key={index}><input type={multiple ? 'checkbox' : 'radio'} name={`answer-${node.id}`} checked={selected.includes(index)} onChange={() => { setRevealed(false); setSelected(multiple ? selected.includes(index) ? selected.filter(i => i !== index) : [...selected, index] : [index]); }}/><span>{option}</span>{revealed && correct.includes(index) && <strong>{t.correct}</strong>}</label>)}</fieldset> : <label>{t.yourAnswer}<textarea rows={4} value={answer} onChange={e => { setAnswer(e.target.value); setRevealed(false); }}/></label>}
    <button type="button" onClick={() => setRevealed(!revealed)}>{revealed ? t.hideAnswer : t.reveal}</button>
    {revealed && <div className="la-answer" role="status">{node.options?.length && correct.length > 0 && <strong>{isCorrect ? t.correct : t.incorrect}</strong>}<p>{node.answer || (node.options?.length && correct.length ? correct.map(i => node.options?.[i]).filter(Boolean).join(', ') : t.noAnswer)}</p></div>}
  </div>;
}

type VideoPresentation = { poster?: string; badge?: string; playLabel: string };

function ContentPlayer({ content, locale, trialGate, videoPresentation, nodeRequest, onVideoProgress, onVideoEnded, onVideoStart, exhibitContainer, onPreviewAccess }: { content: LessonContent; locale: LessonLocale; trialGate?: TrialGate; videoPresentation?: VideoPresentation; nodeRequest?: { id: string; request: number }; onVideoProgress?: (progress: VideoPlaybackProgress) => void; onVideoEnded?: (progress: VideoPlaybackProgress) => void; onVideoStart?: (contentId: string) => void; exhibitContainer?: HTMLElement | null; onPreviewAccess?: () => void }) {
  const t = lessonMessages(locale), video = useRef<HTMLVideoElement>(null), seen = useRef(new Set<string>()), lastTime = useRef(-0.01), resume = useRef(false), seeking = useRef(false);
  const [active, setActive] = useState<LessonNode | null>(null), activeRef = useRef<LessonNode | null>(null);
  const [trialOpen, setTrialOpen] = useState(false);
  const [started, setStarted] = useState(false);
  const [exhibitPrompt, setExhibitPrompt] = useState<LessonNode | null>(null);
  const [videoFullscreen,setVideoFullscreen] = useState(false);
  const nodes = videoExhibitNodes(content, locale), titles = Object.fromEntries(nodes.map(node => [node.id, node.title || t.newNode]));
  const contentTrialGate = content.type === 'video' ? trialGate : undefined;
  const startApplied = useRef(false);
  function initialiseVideo() {
    const media = video.current;
    if (!startApplied.current && media) {
      const start = content.startSeconds || 0;
      seen.current = new Set(nodes.filter(node => node.triggerTime < start).map(node => node.id));
      lastTime.current = start - 0.01;
      if (start > 0) media.currentTime = start;
      startApplied.current = true;
    }
    reportProgress();
  }
  useEffect(() => {
    if (!nodeRequest || contentTrialGate) return;
    const node = nodes.find(item => item.id === nodeRequest.id);
    if (node) open(node);
    // Each explicit request opens once, including repeated requests for the same node.
  }, [nodeRequest, contentTrialGate]);
  function showTrial() {
    video.current?.pause();
    if (onPreviewAccess) { onPreviewAccess(); return; }
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    setTrialOpen(true);
  }
  function enforceVideoTrial() {
    if (!contentTrialGate) return false;
    const media = video.current, limit = contentTrialGate.videoLimitSeconds ?? 60;
    if (!media) return false;
    if (media.currentTime >= limit) {
      if (media.currentTime > limit) media.currentTime = limit;
      showTrial();
      return true;
    }
    return false;
  }
  async function open(node: LessonNode) {
    setExhibitPrompt(null);
    if (!activeRef.current) resume.current = !!video.current && !video.current.paused && !video.current.ended;
    video.current?.pause();
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
    activeRef.current = node; setActive(node);
  }
  function close() { activeRef.current = null; setActive(null); if (resume.current && video.current) { resume.current = false; void video.current.play().catch(() => undefined); } }
  function reportProgress() {
    const media = video.current;
    if (media) onVideoProgress?.({ contentId: content.id, currentTime: media.currentTime, duration: playbackDuration(media) });
  }
  function tick() {
    const media = video.current; if (!media || seeking.current || activeRef.current) return;
    const now = media.currentTime;
    const due = dueVideoNodes(nodes, lastTime.current, now, seen.current, content.mode === 'interactive');
    if (due[0]) { seen.current.add(due[0].id); if (due[0].type === 'exercise') open(due[0]); else setExhibitPrompt(due[0]); }
    else lastTime.current = now;
  }
  return <section className="la-content-player"><h3>{content.title}</h3>
    {content.type === 'text' && <TextExhibitContent html={content.html || ''} locale={locale} exhibitMode={content.exhibitMode}/>}
    {content.type === 'pdf' && <CourseMediaPreview type="pdf" url={content.url} title={content.title} locale={locale}/>}
    {content.type === 'video' && (safeMediaUrl(content.url) ? <div className="la-video-stage"><ControlledVideo locale={locale} ref={video} onFullscreenChange={setVideoFullscreen} exitFullscreenRequested={!!active} fullscreenOverlay={exhibitPrompt ? <VideoExhibitBar presentation="fullscreen" node={exhibitPrompt} locale={locale} onDismiss={() => setExhibitPrompt(null)} onView={() => void open(exhibitPrompt)}/> : undefined} className="la-lesson-video" src={safeMediaUrl(content.url)} poster={videoPresentation?.poster ? safeMediaUrl(videoPresentation.poster) : undefined} playsInline preload="metadata" onLoadedMetadata={initialiseVideo} onDurationChange={reportProgress} onTimeUpdate={() => { if (!enforceVideoTrial()) { reportProgress(); tick(); } }} onPlay={() => { setStarted(true); if (enforceVideoTrial() || activeRef.current) video.current?.pause(); else { onVideoStart?.(content.id); reportProgress(); tick(); } }} onSeeking={() => { seeking.current = true; }} onSeeked={() => {
      const now = video.current?.currentTime || 0;
      if (enforceVideoTrial()) { seeking.current = false; return; }
      // A forward seek skips earlier instances; seeking backwards rearms later ones.
      seen.current = new Set(nodes.filter(node => node.triggerTime < now - 0.05).map(node => node.id));
      setExhibitPrompt(null); lastTime.current = now - 0.05; seeking.current = false; reportProgress(); tick();
    }} onEnded={() => { resume.current = false; reportProgress(); const media = video.current; if (media && Number.isFinite(media.duration) && media.duration > 0) { if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); onVideoEnded?.({ contentId: content.id, currentTime: media.currentTime, duration: media.duration }); } }}/>{videoPresentation?.badge && <span className="la-video-badge">{videoPresentation.badge}</span>}{videoPresentation && !started && <button type="button" className="la-video-play" aria-label={videoPresentation.playLabel} onClick={() => { void video.current?.play().catch(() => undefined); }}><span aria-hidden="true">▶</span></button>}</div> : null)}
    {content.type === "video" && !videoFullscreen && exhibitPrompt && (exhibitContainer ? createPortal(<VideoExhibitBar node={exhibitPrompt} locale={locale} onDismiss={() => setExhibitPrompt(null)} onView={() => open(exhibitPrompt)}/>, exhibitContainer) : <VideoExhibitBar node={exhibitPrompt} locale={locale} onDismiss={() => setExhibitPrompt(null)} onView={() => open(exhibitPrompt)}/>) }
    {content.type !== 'video' && nodes.length > 0 && <div className="la-node-links" aria-label={t.nodes}>{nodes.map(node => <button type="button" key={node.id} onClick={() => open(node)}>{node.title || t.newNode}</button>)}</div>}
    {active && (["image", "video", "model3d"].includes(active.type) ? <ExhibitDialog key={active.id} node={active} locale={locale} onClose={() => { resume.current = false; close(); }}/> : <LessonModal title={active.title || t.newNode} locale={locale} onClose={close}>
      {active.type === 'text' ? <SafeLessonHtml html={active.html || ''} nodeTitles={titles} onNode={id => { const node = nodes.find(n => n.id === id); if (node) open(node); }}/ > : active.type === 'exercise' ? <Exercise key={active.id} node={active} locale={locale}/> : <CourseMediaPreview key={active.id} type={active.type} url={active.url} title={active.title} locale={locale}/>}
      <div className="la-actions"><button type="button" onClick={close}>{t.resume}</button></div>
    </LessonModal>)}
    {contentTrialGate && trialOpen && <TrialLimitModal gate={contentTrialGate} locale={locale} onClose={() => setTrialOpen(false)} />}
  </section>;
}

export function LessonContentPlayer({ contents, locale, trialGate, selectedContentId, initialContentId, onContentChange, hideNavigation = false, videoPresentation, nodeRequest, onVideoProgress, onVideoEnded, onVideoStart, exhibitContainer, onPreviewAccess }: { contents: LessonContent[]; locale: LessonLocale; fallbackImageUrl?: string | null; trialGate?: TrialGate; selectedContentId?: string; initialContentId?: string; onContentChange?: (id: string) => void; hideNavigation?: boolean; videoPresentation?: VideoPresentation; nodeRequest?: { id: string; request: number }; onVideoProgress?: (progress: VideoPlaybackProgress) => void; onVideoEnded?: (progress: VideoPlaybackProgress) => void; onVideoStart?: (contentId: string) => void; exhibitContainer?: HTMLElement | null; onPreviewAccess?: () => void }) {
  contents = contents.filter(content => content.active !== false);
  const [selectedId, setSelectedId] = useState(initialContentId || contents[0]?.id || '');
  const selected = contents.find(content => content.id === (selectedContentId ?? selectedId)) || contents[0];
  return <div className="la la-player">{!hideNavigation && contents.length > 1 && <nav className="la-content-nav" aria-label={lessonMessages(locale).contents}>{contents.map((content, index) => <button type="button" key={content.id} aria-current={content.id === selected?.id ? 'step' : undefined} onClick={() => { setSelectedId(content.id); onContentChange?.(content.id); }}><span>{index + 1}</span>{content.title}</button>)}</nav>}{selected ? <ContentPlayer key={`${selected.id}:${selected.url || ''}`} content={selected} locale={locale} trialGate={trialGate} videoPresentation={videoPresentation} nodeRequest={nodeRequest} onVideoProgress={onVideoProgress} onVideoEnded={onVideoEnded} onVideoStart={onVideoStart} exhibitContainer={exhibitContainer} onPreviewAccess={onPreviewAccess}/> : <p>{lessonMessages(locale).empty}</p>}</div>;
}

export function LegacyLessonBody({ body, locale }: { body: string; locale: LessonLocale }) {
  const html = body.split(/\n\s*\n/).filter(Boolean).map(paragraph => `<p>${paragraph.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')}</p>`).join('');
  return <div className="lesson-body"><TextExhibitContent html={html} locale={locale}/></div>;
}
