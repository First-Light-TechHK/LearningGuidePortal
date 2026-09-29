"use client";

import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X, Upload } from 'lucide-react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { lessonMessages, type LessonLocale } from '@/messages/lesson-authoring';
import { CourseUploadActivity } from './CourseUploadActivity';
import './lesson-authoring.css';

const CourseModelPreview = dynamic(() => import('./CourseModelPreview').then(m => m.CourseModelPreview), { ssr: false });
const CoursePdfPreview = dynamic(() => import('./CoursePdfPreview').then(m => m.CoursePdfPreview), { ssr: false });

export function safeMediaUrl(value: string | undefined): string {
  if (!value || /[\u0000-\u0020\\]/.test(value)) return '';
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}

// Build a new document from an explicit allow-list. Never return unfiltered stored HTML.
export function sanitiseLessonHtml(html: string): string {
  if (typeof DOMParser === 'undefined') return '';
  const source = new DOMParser().parseFromString(html, 'text/html');
  const target = document.implementation.createHTMLDocument('');
  const allowed = new Set('p br h1 h2 h3 h4 h5 h6 strong b em i u s del code pre blockquote ul ol li hr a img span div mark sub sup table thead tbody tfoot tr th td label input'.split(' '));
  const blocked = new Set('script style iframe object embed svg math template form button textarea select video audio source'.split(' '));
  function copy(node: Node, parent: Node) {
    if (node.nodeType === Node.TEXT_NODE) { parent.appendChild(target.createTextNode(node.textContent || '')); return; }
    if (!(node instanceof Element) || blocked.has(node.localName)) return;
    if (!allowed.has(node.localName)) { node.childNodes.forEach(child => copy(child, parent)); return; }
    const el = target.createElement(node.localName);
    for (const name of ['title', 'alt', 'data-node-id', 'data-caption', 'data-instance-answer-result']) if (node.hasAttribute(name)) el.setAttribute(name, (node.getAttribute(name) || '').slice(0, name === 'data-instance-answer-result' ? 10000 : 2000));
    for (const name of ['class', 'data-instance-type', 'data-instance-answer-type']) if (node.hasAttribute(name)) el.setAttribute(name, (node.getAttribute(name) || '').slice(0, 80));
    for (const name of ['width', 'height', 'colspan', 'rowspan', 'start']) {
      const n = Number(node.getAttribute(name)); if (Number.isInteger(n) && n > 0 && n <= 4000) el.setAttribute(name, String(n));
    }
    for (const name of ['data-type', 'data-checked', 'data-image-inline', 'data-image-align']) {
      const value = node.getAttribute(name); if (value && ['taskList', 'taskItem', 'true', 'false', 'left', 'center', 'right'].includes(value)) el.setAttribute(name, value);
    }
    if (el.localName === 'span' && el.getAttribute('class') !== 'instance-node') el.removeAttribute('class');
    if (el.localName === 'span' && el.hasAttribute('data-instance-type')) {
      if (!/^[1-6]$/.test(el.getAttribute('data-instance-type') || '')) el.removeAttribute('data-instance-type');
      el.removeAttribute('data-instance-content');
      if (el.hasAttribute('data-instance-answer-type') && !['input', 'single', 'multiple'].includes(el.getAttribute('data-instance-answer-type') || '')) el.removeAttribute('data-instance-answer-type');
    } else {
      for (const name of ['data-instance-content', 'data-instance-answer-type', 'data-instance-answer-result']) el.removeAttribute(name);
    }
    if (el.localName === 'img') { const src = safeMediaUrl(node.getAttribute('src') || ''); if (!src) return; el.setAttribute('src', src); }
    if (el.localName === 'a') { const href = safeMediaUrl(node.getAttribute('href') || ''); if (href) el.setAttribute('href', href); el.setAttribute('rel', 'noopener noreferrer'); }
    if (el.localName === 'input') { if (node.getAttribute('type') !== 'checkbox') return; el.setAttribute('type', 'checkbox'); el.setAttribute('disabled', ''); if (node.hasAttribute('checked')) el.setAttribute('checked', ''); }
    const align = (node as HTMLElement).style?.textAlign;
    if (['left', 'center', 'right', 'justify'].includes(align)) el.style.textAlign = align;
    const colour = (node as HTMLElement).style?.backgroundColor;
    if (el.localName === 'mark' && /^(#[\da-f]{3,8}|rgba?\([\d\s,.%]+\)|[a-z]+)$/i.test(colour)) el.style.backgroundColor = colour;
    node.childNodes.forEach(child => copy(child, el)); parent.appendChild(el);
  }
  source.body.childNodes.forEach(node => copy(node, target.body));
  return target.body.innerHTML;
}

export function SafeLessonHtml({ html, onNode, nodeTitles }: { html: string; onNode?: (id: string) => void; nodeTitles?: Record<string, string> }) {
  const [safe, setSafe] = useState('');
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { setSafe(sanitiseLessonHtml(html)); }, [html]);
  useEffect(() => {
    root.current?.querySelectorAll<HTMLElement>('[data-node-id]').forEach(el => {
      const id = el.dataset.nodeId || '';
      const disabled = !!nodeTitles && !Object.hasOwn(nodeTitles, id);
      el.classList.add('la-instance'); el.setAttribute('role', 'button'); el.tabIndex = disabled ? -1 : 0; el.setAttribute('aria-disabled', String(disabled));
      if (nodeTitles?.[id] && el.textContent !== nodeTitles[id]) el.textContent = nodeTitles[id];
    });
  }, [safe, nodeTitles]);
  function activate(target: EventTarget | null) { const el = target instanceof Element ? target.closest<HTMLElement>('[data-node-id]') : null; if (el && el.getAttribute('aria-disabled') !== 'true') { el.focus(); onNode?.(el.getAttribute('data-node-id') || ''); } return !!el; }
  const markup = useMemo(() => <div ref={root} className="la-prose" dangerouslySetInnerHTML={{ __html: safe }}/>, [safe]);
  return <div onClick={e => { if (activate(e.target)) e.preventDefault(); }} onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && activate(e.target)) e.preventDefault(); }}>{markup}</div>;
}

export function LessonModal({ title, locale, onClose, children }: { title: string; locale: LessonLocale; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const dialog = ref.current; dialog?.showModal();
    return () => { dialog?.close(); if (before?.isConnected) before.focus(); };
  }, []);
  return createPortal(<dialog ref={ref} className="la-modal la" aria-label={title} onCancel={e => { e.preventDefault(); close.current(); }} onClick={e => { if (e.target === e.currentTarget) { const box = e.currentTarget.getBoundingClientRect(); if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) close.current(); } }}>
    <header className="la-heading"><h3>{title}</h3><button type="button" className="la-icon" aria-label={lessonMessages(locale).close} title={lessonMessages(locale).close} onClick={onClose}><X size={20}/></button></header>
    <div className="la-modal-body">{children}</div>
  </dialog>, document.body);
}

export function MediaUpload({ courseId, value, onChange, accept, locale }: { courseId: string; value: string; onChange: (url: string) => void; accept: string; locale: LessonLocale }) {
  const t = lessonMessages(locale), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const beginUpload = useContext(CourseUploadActivity);
  const controller = useRef<AbortController | null>(null), latest = useRef(onChange); latest.current = onChange;
  useEffect(() => () => controller.current?.abort(), []);
  async function upload(file: File) {
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    const finishUpload = beginUpload?.();
    setBusy(true); setError('');
    try {
      const form = new FormData(); form.append('file', file);
      const response = await fetch(`/api/backoffice/courses/${encodeURIComponent(courseId)}/media`, { method: 'POST', body: form, signal: request.signal });
      const result = await response.json();
      if (!response.ok || result.ok !== true || !safeMediaUrl(result.data?.url)) throw new Error('upload');
      if (!request.signal.aborted) latest.current(result.data.url);
    } catch { if (!request.signal.aborted) setError(t.uploadFailed); }
    finally { finishUpload?.(); if (!request.signal.aborted) setBusy(false); }
  }
  return <div className="la-upload"><label>{t.url}<input type="text" value={value} disabled={busy} onChange={e => onChange(e.target.value)} aria-invalid={!!value && !safeMediaUrl(value)}/></label><label className="la-file"><Upload size={16}/>{busy ? t.uploading : t.upload}<input type="file" accept={accept} disabled={busy} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void upload(file); }}/></label>{(error || (value && !safeMediaUrl(value))) && <p role="alert">{error || t.invalidUrl}</p>}</div>;
}

export function CourseMediaPreview({ type, url, title = '', locale }: { type: 'video' | 'image' | 'audio' | 'pdf' | 'model3d'; url?: string; title?: string; locale: LessonLocale }) {
  const t = lessonMessages(locale), src = safeMediaUrl(url);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url, type]);
  if (!src || failed) return <p role="alert">{src ? t.mediaFailed : t.invalidUrl}</p>;
  return <div className="la-media" key={src}>
    {/* Uploaded images have no known dimensions; .la-media img sizes them to width:100% and height:auto. */}
    {type === 'image' && <Image src={src} alt={title} width={0} height={0} unoptimized onError={() => setFailed(true)}/>}
    {type === 'video' && <video src={src} controls playsInline preload="metadata" onError={() => setFailed(true)}/>}
    {type === 'audio' && <audio src={src} controls preload="metadata" onError={() => setFailed(true)}/>}
    {type === 'pdf' && <CoursePdfPreview url={src} title={title} locale={locale}/>}
    {type === 'model3d' && <CourseModelPreview url={src} locale={locale} title={title}/>}
  </div>;
}
