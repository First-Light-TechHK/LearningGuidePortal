"use client";

import { useRef, useState } from 'react';
import type { LessonContent, LessonNode } from '@/contracts/lesson-content';
import { lessonMessages, type LessonLocale } from '@/messages/lesson-authoring';
import { CourseMediaPreview, LessonModal, SafeLessonHtml, safeMediaUrl } from './CourseMediaPreview';
import './lesson-authoring.css';

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

function ContentPlayer({ content, locale }: { content: LessonContent; locale: LessonLocale }) {
  const t = lessonMessages(locale), video = useRef<HTMLVideoElement>(null), seen = useRef(new Set<string>()), lastTime = useRef(-0.01), resume = useRef(false), seeking = useRef(false);
  const [active, setActive] = useState<LessonNode | null>(null), activeRef = useRef<LessonNode | null>(null), [notice, setNotice] = useState('');
  const nodes = (content.nodes || []).filter(node => node.active !== false), titles = Object.fromEntries(nodes.map(node => [node.id, node.title || t.newNode]));
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
    {content.type === 'text' && <SafeLessonHtml html={content.html || ''} nodeTitles={titles} onNode={id => { const node = nodes.find(n => n.id === id); if (node) open(node); else setNotice(t.missingNode); }}/ >}
    {content.type === 'pdf' && <CourseMediaPreview type="pdf" url={content.url} title={content.title} locale={locale}/>}
    {content.type === 'video' && (safeMediaUrl(content.url) ? <video ref={video} className="la-lesson-video" src={safeMediaUrl(content.url)} controls playsInline preload="metadata" onTimeUpdate={tick} onPlay={() => { if (activeRef.current) video.current?.pause(); else tick(); }} onSeeking={() => { seeking.current = true; }} onSeeked={() => {
      const now = video.current?.currentTime || 0;
      // A forward seek skips earlier instances; seeking backwards rearms later ones.
      seen.current = new Set(nodes.filter(node => node.triggerTime < now - 0.05).map(node => node.id));
      lastTime.current = now - 0.05; seeking.current = false; tick();
    }} onEnded={() => { resume.current = false; }} onError={() => setNotice(t.mediaFailed)}/> : <p role="alert">{t.invalidUrl}</p>)}
    {nodes.length > 0 && <div className="la-node-links" aria-label={t.nodes}>{nodes.map(node => <button type="button" key={node.id} onClick={() => open(node)}>{content.type === 'video' && <time>{Math.floor(node.triggerTime / 60)}:{String(Math.floor(node.triggerTime % 60)).padStart(2, '0')}</time>}{node.title || t.newNode}</button>)}</div>}
    {notice && <p role="status">{notice}</p>}
    {active && <LessonModal title={active.title || t.newNode} locale={locale} onClose={close}>
      {active.type === 'text' ? <SafeLessonHtml html={active.html || ''} nodeTitles={titles} onNode={id => { const node = nodes.find(n => n.id === id); if (node) open(node); }}/ > : active.type === 'exercise' ? <Exercise key={active.id} node={active} locale={locale}/> : <CourseMediaPreview key={active.id} type={active.type} url={active.url} title={active.title} locale={locale}/>}
      <div className="la-actions"><button type="button" onClick={close}>{t.resume}</button></div>
    </LessonModal>}
  </section>;
}

export function LessonContentPlayer({ contents, locale }: { contents: LessonContent[]; locale: LessonLocale }) {
  contents = contents.filter(content => content.active !== false);
  const [selectedId, setSelectedId] = useState(contents[0]?.id || '');
  const selected = contents.find(content => content.id === selectedId) || contents[0];
  return <div className="la la-player">{contents.length > 1 && <nav className="la-content-nav" aria-label={lessonMessages(locale).contents}>{contents.map((content, index) => <button type="button" key={content.id} aria-current={content.id === selected?.id ? 'step' : undefined} onClick={() => setSelectedId(content.id)}><span>{index + 1}</span>{content.title}</button>)}</nav>}{selected ? <ContentPlayer key={`${selected.id}:${selected.url || ''}`} content={selected} locale={locale}/> : <p>{lessonMessages(locale).empty}</p>}</div>;
}
