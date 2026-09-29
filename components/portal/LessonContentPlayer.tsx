"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, X } from 'lucide-react';
import type { LessonContent, LessonNode } from '@/contracts/lesson-content';
import { lessonMessages, type LessonLocale } from '@/messages/lesson-authoring';
import { CourseMediaPreview, LessonModal, SafeLessonHtml, safeMediaUrl } from './CourseMediaPreview';
import './lesson-authoring.css';

const LEGACY_MEDIA_BASE = 'https://learningguide-1380131816.cos.ap-hongkong.myqcloud.com/mvp';

type Exhibit = { title: string; type: 'article' | 'video' | 'image' | 'audio' | 'model3d' | 'exercise'; url: string; html: string; missing: boolean };
type TrialRecommendation = { title: string; href: string; image?: string | null; category?: string | null };
export type TrialGate = { pricingHref: string; recommendations: TrialRecommendation[]; videoLimitSeconds?: number };

function exhibitType(value: string | null): Exhibit['type'] | null {
  if (value === '1') return 'article';
  if (value === '2') return 'video';
  if (value === '3') return 'exercise';
  if (value === '4') return 'image';
  if (value === '5') return 'model3d';
  if (value === '6') return 'audio';
  return null;
}

function exhibitUrl(value: string, type: Exhibit['type']) {
  if (type === 'article' || type === 'exercise') return '';
  if (/^https:\/\//i.test(value)) return safeMediaUrl(value);
  if (value.startsWith('/') && !value.startsWith('//')) return safeMediaUrl(encodeURI(`${LEGACY_MEDIA_BASE}${value}`));
  return safeMediaUrl(value);
}

function TrialLimitModal({ gate, locale, onClose }: { gate: TrialGate; locale: LessonLocale; onClose: () => void }) {
  const copy = {
    title: 'Preview limit reached',
    body: 'Subscribe to continue the full course and unlock more courses in this category.',
    pricing: 'View pricing',
    other: 'Related courses',
    close: 'Close',
    empty: 'No related courses yet',
    heroTitle: 'Enjoying the course so far?',
    heroBody: 'Build on what you’ve discovered with more ways to explore, reflect, and connect.',
    bullets: ['Continue this lesson and unlock the full course', 'Deepen your understanding with AI Tutor', 'Discover more exhibits, ideas, and perspectives'],
    cta: 'Ready for learning futhur',
    categoryTitle: 'More in this category',
    categoryBody: 'Other courses to explore',
    relatedBody: 'Explore another perspective in this category.',
    viewCourse: 'View course'
  };
  return <div className="la-trial-backdrop" role="presentation">
    <section className="la-trial-modal" role="dialog" aria-modal="true" aria-labelledby="la-trial-title">
      <button type="button" className="la-trial-close" aria-label={copy.close} onClick={onClose}><X size={24} aria-hidden="true" /></button>
      <div className="la-trial-upgrade">
        <h3 id="la-trial-title">{copy.heroTitle}</h3>
        <p>{copy.heroBody}</p>
        <ul>{copy.bullets.map(item => <li key={item}><CheckCircle2 size={16} aria-hidden="true" />{item}</li>)}</ul>
      </div>
      <div className="la-trial-related">
        <strong>{copy.other}</strong>
        <div className="la-trial-course-list">{gate.recommendations.length ? gate.recommendations.slice(0, 2).map((course, index) => <a className="la-trial-course" href={course.href} key={course.href}>
          {course.image ? <img src={course.image} alt=""/> : <span className={`la-trial-course-placeholder la-trial-course-placeholder-${index + 1}`} aria-hidden="true">IMAGE</span>}
          <span><b>{course.title}</b><small>{copy.relatedBody}</small><em>{copy.viewCourse}<ArrowRight size={15} aria-hidden="true" /></em></span>
        </a>) : <p className="la-trial-empty">{copy.empty}</p>}</div>
      </div>
      <a className="la-trial-pricing" href={gate.pricingHref}>{copy.cta}</a>
    </section>
  </div>;
}

function TextContentPlayer({ html, nodes, locale, fallbackImageUrl, onNode }: { html: string; nodes: LessonNode[]; locale: LessonLocale; fallbackImageUrl?: string | null; onNode: (node: LessonNode) => void }) {
  const root = useRef<HTMLDivElement>(null), visible = useRef(new Set<HTMLElement>());
  const [active, setActive] = useState<Exhibit | null>(null), [modal, setModal] = useState<Exhibit | null>(null);
  const nodeTitles = useMemo(() => Object.fromEntries(nodes.map(node => [node.id, node.title || lessonMessages(locale).newNode])), [nodes, locale]);
  function fromElement(el: HTMLElement): Exhibit | null {
    const type = exhibitType(el.dataset.instanceType || null), raw = el.dataset.instanceContent || '';
    if (!type) return null;
    const title = el.textContent?.trim() || 'Exhibit';
    const exhibitNumber = title.match(/<\s*Exh\s*(\d+)\s*>/i)?.[1];
    const fallback = safeMediaUrl(exhibitNumber === '2' || exhibitNumber === '3' ? '/portal/exh2.jpg' : fallbackImageUrl || '');
    if (fallback) return { title, type: 'image', url: fallback, html: '', missing: false };
    if (!raw) return { title, type: 'image', url: safeMediaUrl(fallbackImageUrl || ''), html: '', missing: !safeMediaUrl(fallbackImageUrl || '') };
    if (type === 'article' || type === 'exercise') return { title, type, url: '', html: raw, missing: false };
    const url = exhibitUrl(raw, type);
    return url ? { title, type, url, html: '', missing: false } : { title, type: 'image', url: safeMediaUrl(fallbackImageUrl || ''), html: '', missing: !safeMediaUrl(fallbackImageUrl || '') };
  }
  function pick() {
    let best: HTMLElement | null = null, top = Infinity;
    visible.current.forEach(el => { const y = el.getBoundingClientRect().top; if (y < top) { top = y; best = el; } });
    setActive(best ? fromElement(best) : null);
  }
  useEffect(() => {
    const container = root.current;
    if (!container) return;
    let observer: IntersectionObserver | null = null;
    const bind = () => {
      observer?.disconnect();
      visible.current.clear();
      observer = new IntersectionObserver(entries => {
      entries.forEach(entry => entry.isIntersecting ? visible.current.add(entry.target as HTMLElement) : visible.current.delete(entry.target as HTMLElement));
      pick();
      }, { root: null, rootMargin: '-80px 0px -45% 0px', threshold: 0 });
      container.querySelectorAll<HTMLElement>('[data-instance-type]').forEach(el => observer?.observe(el));
      pick();
    };
    const mutation = new MutationObserver(bind);
    mutation.observe(container, { childList: true, subtree: true });
    const frame = window.requestAnimationFrame(bind);
    window.addEventListener('scroll', pick, { passive: true });
    window.addEventListener('resize', pick);
    return () => { window.cancelAnimationFrame(frame); mutation.disconnect(); observer?.disconnect(); window.removeEventListener('scroll', pick); window.removeEventListener('resize', pick); };
  }, [html]);
  function click(target: EventTarget | null) {
    const element = target instanceof Element ? target.closest<HTMLElement>('[data-instance-type]') : null;
    if (element && root.current?.contains(element)) {
      const exhibit = fromElement(element);
      if (exhibit) setModal(exhibit);
      return true;
    }
    return false;
  }
  return <div className="la-text-exhibit-layout">
    <div ref={root} onClick={event => { if (click(event.target)) event.preventDefault(); }}>
      <SafeLessonHtml html={html} nodeTitles={nodeTitles} onNode={id => { const node = nodes.find(n => n.id === id); if (node) onNode(node); }}/>
    </div>
    {active && <aside className="la-exhibit-float" aria-live="polite">
      <button type="button" className="la-exhibit-close" aria-label={lessonMessages(locale).close} onClick={() => setActive(null)}>x</button>
      <span className="la-exhibit-kind">{active.type === 'image' ? 'Image' : active.type === 'article' || active.type === 'exercise' ? 'Text' : active.type}</span>
      <strong>{active.title}</strong>
      {active.missing && <p className="la-exhibit-empty">No exhibit content is linked yet.</p>}
      {!active.missing && active.type === 'image' && <img src={active.url} alt={active.title}/>}
      {!active.missing && (active.type === 'article' || active.type === 'exercise') && <SafeLessonHtml html={active.html} />}
      {!active.missing && active.type !== 'image' && active.type !== 'article' && active.type !== 'exercise' && <CourseMediaPreview type={active.type === 'model3d' ? 'model3d' : active.type === 'audio' ? 'audio' : 'video'} url={active.url} title={active.title} locale={locale}/>}
      <button type="button" className="la-exhibit-detail" onClick={() => setModal(active)}>Open preview</button>
    </aside>}
    {modal && <LessonModal title={modal.title} locale={locale} onClose={() => setModal(null)}>
      {modal.missing ? <p className="la-exhibit-empty">No exhibit content is linked yet.</p> : modal.type === 'article' || modal.type === 'exercise' ? <SafeLessonHtml html={modal.html}/> : <CourseMediaPreview type={modal.type === 'model3d' ? 'model3d' : modal.type === 'audio' ? 'audio' : modal.type === 'image' ? 'image' : 'video'} url={modal.url} title={modal.title} locale={locale}/>}
    </LessonModal>}
  </div>;
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

function ContentPlayer({ content, locale, fallbackImageUrl, trialGate, videoPresentation, nodeRequest }: { content: LessonContent; locale: LessonLocale; fallbackImageUrl?: string | null; trialGate?: TrialGate; videoPresentation?: VideoPresentation; nodeRequest?: { id: string; request: number } }) {
  const t = lessonMessages(locale), video = useRef<HTMLVideoElement>(null), seen = useRef(new Set<string>()), lastTime = useRef(-0.01), resume = useRef(false), seeking = useRef(false);
  const [active, setActive] = useState<LessonNode | null>(null), activeRef = useRef<LessonNode | null>(null), [notice, setNotice] = useState('');
  const [trialOpen, setTrialOpen] = useState(false);
  const [started, setStarted] = useState(false);
  const nodes = (content.nodes || []).filter(node => node.active !== false), titles = Object.fromEntries(nodes.map(node => [node.id, node.title || t.newNode]));
  const contentTrialGate = content.type === 'video' ? trialGate : undefined;
  useEffect(() => {
    if (!nodeRequest || contentTrialGate) return;
    const node = content.nodes.find(item => item.active !== false && item.id === nodeRequest.id);
    if (node) open(node);
    // Each explicit request opens once, including repeated requests for the same node.
  }, [nodeRequest, contentTrialGate]);
  function showTrial() { video.current?.pause(); setTrialOpen(true); }
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
  function open(node: LessonNode) {
    if (!activeRef.current) resume.current = !!video.current && !video.current.paused && !video.current.ended;
    video.current?.pause(); activeRef.current = node; setActive(node); setNotice('');
  }
  function close() { activeRef.current = null; setActive(null); if (resume.current && video.current) { resume.current = false; void video.current.play().catch(() => setNotice(t.playbackBlocked)); } }
  function tick() {
    const media = video.current; if (!media || seeking.current || activeRef.current || content.mode !== 'interactive') return;
    const now = media.currentTime;
    const due = nodes.filter(node => Number.isFinite(node.triggerTime) && node.triggerTime >= lastTime.current && node.triggerTime <= now && !seen.current.has(node.id)).sort((a, b) => a.triggerTime - b.triggerTime);
    if (due[0]) { seen.current.add(due[0].id); open(due[0]); }
    else lastTime.current = now;
  }
  return <section className="la-content-player"><h3>{content.title}</h3>
    {content.type === 'text' && <TextContentPlayer html={content.html || ''} nodes={nodes} locale={locale} fallbackImageUrl={fallbackImageUrl} onNode={open}/>}
    {content.type === 'pdf' && <CourseMediaPreview type="pdf" url={content.url} title={content.title} locale={locale}/>}
    {content.type === 'video' && (safeMediaUrl(content.url) ? <div className="la-video-stage"><video ref={video} className="la-lesson-video" src={safeMediaUrl(content.url)} poster={videoPresentation?.poster ? safeMediaUrl(videoPresentation.poster) : undefined} controls playsInline preload="metadata" onTimeUpdate={() => { if (!enforceVideoTrial()) tick(); }} onPlay={() => { setStarted(true); if (enforceVideoTrial() || activeRef.current) video.current?.pause(); else tick(); }} onSeeking={() => { seeking.current = true; }} onSeeked={() => {
      const now = video.current?.currentTime || 0;
      if (enforceVideoTrial()) { seeking.current = false; return; }
      // A forward seek skips earlier instances; seeking backwards rearms later ones.
      seen.current = new Set(nodes.filter(node => node.triggerTime < now - 0.05).map(node => node.id));
      lastTime.current = now - 0.05; seeking.current = false; tick();
    }} onEnded={() => { resume.current = false; }} onError={() => setNotice(t.mediaFailed)}/>{videoPresentation?.badge && <span className="la-video-badge">{videoPresentation.badge}</span>}{videoPresentation && !started && <button type="button" className="la-video-play" aria-label={videoPresentation.playLabel} onClick={() => { void video.current?.play().catch(() => setNotice(t.playbackBlocked)); }}><span aria-hidden="true">▶</span></button>}</div> : <p role="alert">{t.invalidUrl}</p>)}
    {nodes.length > 0 && <div className="la-node-links" aria-label={t.nodes}>{nodes.map(node => <button type="button" key={node.id} onClick={() => open(node)}>{content.type === 'video' && <time>{Math.floor(node.triggerTime / 60)}:{String(Math.floor(node.triggerTime % 60)).padStart(2, '0')}</time>}{node.title || t.newNode}</button>)}</div>}
    {notice && <p role="status">{notice}</p>}
    {active && <LessonModal title={active.title || t.newNode} locale={locale} onClose={close}>
      {active.type === 'text' ? <SafeLessonHtml html={active.html || ''} nodeTitles={titles} onNode={id => { const node = nodes.find(n => n.id === id); if (node) open(node); }}/ > : active.type === 'exercise' ? <Exercise key={active.id} node={active} locale={locale}/> : <CourseMediaPreview key={active.id} type={active.type} url={active.url} title={active.title} locale={locale}/>}
      <div className="la-actions"><button type="button" onClick={close}>{t.resume}</button></div>
    </LessonModal>}
    {contentTrialGate && trialOpen && <TrialLimitModal gate={contentTrialGate} locale={locale} onClose={() => setTrialOpen(false)} />}
  </section>;
}

export function LessonContentPlayer({ contents, locale, fallbackImageUrl = null, trialGate, selectedContentId, onContentChange, hideNavigation = false, videoPresentation, nodeRequest }: { contents: LessonContent[]; locale: LessonLocale; fallbackImageUrl?: string | null; trialGate?: TrialGate; selectedContentId?: string; onContentChange?: (id: string) => void; hideNavigation?: boolean; videoPresentation?: VideoPresentation; nodeRequest?: { id: string; request: number } }) {
  contents = contents.filter(content => content.active !== false);
  const [selectedId, setSelectedId] = useState(contents[0]?.id || '');
  const selected = contents.find(content => content.id === (selectedContentId ?? selectedId)) || contents[0];
  return <div className="la la-player">{!hideNavigation && contents.length > 1 && <nav className="la-content-nav" aria-label={lessonMessages(locale).contents}>{contents.map((content, index) => <button type="button" key={content.id} aria-current={content.id === selected?.id ? 'step' : undefined} onClick={() => { setSelectedId(content.id); onContentChange?.(content.id); }}><span>{index + 1}</span>{content.title}</button>)}</nav>}{selected ? <ContentPlayer key={`${selected.id}:${selected.url || ''}`} content={selected} locale={locale} fallbackImageUrl={fallbackImageUrl} trialGate={trialGate} videoPresentation={videoPresentation} nodeRequest={nodeRequest}/> : <p>{lessonMessages(locale).empty}</p>}</div>;
}

export function LegacyLessonBody({ body, locale }: { body: string; locale: LessonLocale }) {
  const html = body.split(/\n\s*\n/).filter(Boolean).map(paragraph => `<p>${paragraph.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')}</p>`).join('');
  return <div className="lesson-body"><TextContentPlayer html={html} nodes={[]} locale={locale} onNode={() => undefined}/></div>;
}
