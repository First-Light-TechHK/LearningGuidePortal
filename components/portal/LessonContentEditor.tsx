"use client";

import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2, Eye, Pencil } from 'lucide-react';
import type { LessonContent, LessonNode } from '@/contracts/lesson-content';
import { lessonMessages, type LessonLocale } from '@/messages/lesson-authoring';
import { CourseMediaPreview, MediaUpload } from './CourseMediaPreview';
import { RichLessonEditor } from './RichLessonEditor';
import { LessonContentPlayer } from './LessonContentPlayer';
import './lesson-authoring.css';

const accepts = { video: 'video/mp4,video/webm,video/ogg', pdf: 'application/pdf', image: 'image/png,image/jpeg,image/webp,image/gif,image/avif', audio: 'audio/mpeg,audio/wav,audio/ogg,audio/mp4', model3d: '.obj,.glb' };
export function newLessonContentId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
function reordered<T>(items: T[], index: number, delta: number) { const next = [...items], target = index + delta; if (target >= 0 && target < next.length) [next[index], next[target]] = [next[target], next[index]]; return next; }

export function LessonContentEditor({ courseId, value, onChange, locale }: { courseId: string; value: LessonContent[]; onChange: (value: LessonContent[]) => void; locale: LessonLocale }) {
  const t = lessonMessages(locale), [preview, setPreview] = useState(false), [newType, setNewType] = useState<LessonContent['type']>('text');
  const current = useRef(value); current.current = value;
  const emit = (next: LessonContent[]) => { current.current = next; onChange(next); };
  const change = (id: string, patch: Partial<LessonContent>) => emit(current.current.map(item => item.id === id ? { ...item, ...patch } : item));
  function changeNode(contentId: string, nodeId: string, patch: Partial<LessonNode>) { const content = current.current.find(c => c.id === contentId); if (content) change(contentId, { nodes: content.nodes.map(node => node.id === nodeId ? { ...node, ...patch } : node) }); }
  function orderButtons(index: number, count: number, move: (delta: number) => void, remove: () => void) { return <div className="la-actions"><button className="la-icon" type="button" title={t.up} aria-label={t.up} disabled={!index} onClick={() => move(-1)}><ArrowUp size={16}/></button><button className="la-icon" type="button" title={t.down} aria-label={t.down} disabled={index === count - 1} onClick={() => move(1)}><ArrowDown size={16}/></button><button className="la-icon" type="button" title={t.delete} aria-label={t.delete} onClick={() => { if (window.confirm(t.deleteConfirm)) remove(); }}><Trash2 size={16}/></button></div>; }
  return <div className="la la-editor"><header className="la-heading"><h3>{t.contents}</h3><button type="button" onClick={() => setPreview(!preview)}>{preview ? <Pencil size={16}/> : <Eye size={16}/>} {preview ? t.edit : t.preview}</button></header>
    {preview ? <LessonContentPlayer contents={value} locale={locale}/> : <>
      {!value.length && <p>{t.empty}</p>}
      {value.map((content, index) => <section className="la-content-group" key={content.id}>
        <div className="la-heading"><span className="la-number">{index + 1}</span><label>{t.title}<input maxLength={255} value={content.title} onChange={e => change(content.id, { title: e.target.value })}/></label>{orderButtons(index, value.length, delta => emit(reordered(current.current, index, delta)), () => emit(current.current.filter(c => c.id !== content.id)))}</div>
        <div className="la-columns"><label>{t.type}<select value={content.type} onChange={e => change(content.id, { type: e.target.value as LessonContent['type'], url: undefined })}>{(['text','video','pdf'] as const).map(type => <option key={type} value={type}>{t[type]}</option>)}</select></label><label>{t.mode}<select value={content.mode} onChange={e => change(content.id, { mode: e.target.value as LessonContent['mode'] })}><option value="lecture">{t.lecture}</option><option value="interactive">{t.interactive}</option></select></label></div>
        <label className="la-check"><input type="checkbox" checked={content.active !== false} onChange={e => change(content.id, { active: e.target.checked })}/>{t.active}</label>
        {content.type === 'text' ? <RichLessonEditor courseId={courseId} value={content.html || ''} onChange={html => change(content.id, { html })} nodes={content.nodes} locale={locale}/> : <><MediaUpload key={content.type} courseId={courseId} value={content.url || ''} onChange={url => change(content.id, { url })} accept={accepts[content.type]} locale={locale}/>{content.url && <CourseMediaPreview type={content.type} url={content.url} title={content.title} locale={locale}/>}</>}
        <div className="la-heading"><h4>{t.nodes}</h4></div>
        {content.nodes.map((node, ni) => <details className="la-node-editor" key={node.id}><summary>{node.title || t.newNode} <span>{t[node.type]}{content.type === 'video' ? ` · ${node.triggerTime}s` : ''}</span></summary><div className="la-fields">
          <div className="la-heading"><label>{t.title}<input value={node.title} maxLength={255} onChange={e => changeNode(content.id, node.id, { title: e.target.value })}/></label>{orderButtons(ni, content.nodes.length, delta => change(content.id, { nodes: reordered(content.nodes, ni, delta) }), () => change(content.id, { nodes: content.nodes.filter(n => n.id !== node.id) }))}</div>
          <div className="la-columns"><label>{t.type}<select value={node.type} onChange={e => changeNode(content.id, node.id, { type: e.target.value as LessonNode['type'], url: undefined, question: undefined, answer: undefined, options: undefined, correctOptions: undefined })}>{(['text','video','image','audio','model3d','exercise'] as const).map(type => <option key={type} value={type}>{t[type]}</option>)}</select></label><label>{t.triggerTime}<input type="number" min={0} max={36000} step={0.1} value={node.triggerTime} onChange={e => changeNode(content.id, node.id, { triggerTime: Math.max(0, Math.min(36000, Number(e.target.value) || 0)) })}/></label></div>
          <label className="la-check"><input type="checkbox" checked={node.active !== false} onChange={e => changeNode(content.id, node.id, { active: e.target.checked })}/>{t.active}</label>
          {node.type === 'text' ? <RichLessonEditor courseId={courseId} value={node.html || ''} onChange={html => changeNode(content.id, node.id, { html })} nodes={content.nodes.filter(n => n.id !== node.id)} locale={locale}/> : node.type === 'exercise' ? <>
            <label>{t.question}<textarea rows={3} value={node.question || ''} onChange={e => changeNode(content.id, node.id, { question: e.target.value })}/></label>
            <label>{t.answerType}<select value={node.options?.length ? 'choice' : 'short'} onChange={e => changeNode(content.id, node.id, { options: e.target.value === 'choice' ? ['', ''] : undefined, correctOptions: e.target.value === 'choice' ? [] : undefined })}><option value="short">{t.shortAnswer}</option><option value="choice">{t.multipleChoice}</option></select></label>
            {!!node.options?.length && <fieldset><legend>{t.options}</legend>{node.options.map((option, oi) => <div className="la-option-edit" key={oi}><input type="checkbox" title={t.correctOption} aria-label={`${t.correctOption} ${oi + 1}`} checked={node.correctOptions?.includes(oi) || false} onChange={e => changeNode(content.id, node.id, { correctOptions: e.target.checked ? [...(node.correctOptions || []), oi] : node.correctOptions?.filter(i => i !== oi) })}/><input aria-label={`${t.options} ${oi + 1}`} value={option} onChange={e => changeNode(content.id, node.id, { options: node.options!.map((v, i) => i === oi ? e.target.value : v) })}/><button className="la-icon" type="button" title={t.delete} aria-label={`${t.delete} ${oi + 1}`} disabled={node.options!.length <= 2} onClick={() => changeNode(content.id, node.id, { options: node.options!.filter((_, i) => i !== oi), correctOptions: node.correctOptions?.filter(i => i !== oi).map(i => i > oi ? i - 1 : i) })}><Trash2 size={16}/></button></div>)}<button type="button" onClick={() => changeNode(content.id, node.id, { options: [...node.options!, ''] })}><Plus size={16}/>{t.addOption}</button></fieldset>}
            <label>{t.answer}<textarea value={node.answer || ''} onChange={e => changeNode(content.id, node.id, { answer: e.target.value })}/></label>
          </> : <><MediaUpload key={node.type} courseId={courseId} value={node.url || ''} onChange={url => changeNode(content.id, node.id, { url })} accept={accepts[node.type]} locale={locale}/>{node.url && <CourseMediaPreview type={node.type} url={node.url} title={node.title} locale={locale}/>}</>}
        </div></details>)}
        <button type="button" onClick={() => change(content.id, { nodes: [...content.nodes, { id: newLessonContentId(), title: t.newNode, type: 'text', html: '', triggerTime: 0 }] })}><Plus size={16}/>{t.addNode}</button>
      </section>)}
      <div className="la-actions"><select aria-label={t.type} value={newType} onChange={e => setNewType(e.target.value as LessonContent['type'])}>{(['text','video','pdf'] as const).map(type => <option key={type} value={type}>{t[type]}</option>)}</select><button type="button" onClick={() => emit([...current.current, { id: newLessonContentId(), title: t.newContent, type: newType, mode: 'lecture', html: '', nodes: [] }])}><Plus size={16}/>{t.addContent}</button></div>
    </>}
  </div>;
}
