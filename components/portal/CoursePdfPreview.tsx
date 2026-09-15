"use client";

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, Maximize, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import { lessonMessages, type LessonLocale } from '@/messages/lesson-authoring';
import './lesson-authoring.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_CANVAS_PIXELS = 8 * 1024 * 1024;

async function readPdf(url: string, signal: AbortSignal): Promise<Uint8Array> {
  const source = new URL(url, window.location.href);
  if (source.origin !== window.location.origin || source.username || source.password || /[\u0000-\u0020\\]/.test(url)) throw new Error('url');
  const response = await fetch(source, { signal, credentials: 'same-origin', mode: 'same-origin', redirect: 'error' });
  if (!response.ok || !response.body) throw new Error('fetch');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('size');
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error('size');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
  if (!size) throw new Error('empty');
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
  return data;
}

export function CoursePdfPreview({ url, title = '', locale }: { url: string; title?: string; locale: LessonLocale }) {
  const t = lessonMessages(locale);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1), [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [scale, setScale] = useState(1), [width, setWidth] = useState(0), [retry, setRetry] = useState(0);
  const [status, setStatus] = useState<'loading' | 'rendering' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<'size' | 'failed'>('failed'), [pageText, setPageText] = useState('');
  const viewport = useRef<HTMLDivElement>(null), pageHost = useRef<HTMLDivElement>(null);
  const renderTask = useRef<RenderTask | null>(null);
  const pageLabel = t.pdfPageCount.replace('{page}', String(pageNumber)).replace('{pages}', String(document?.numPages || 0));

  useEffect(() => {
    const element = viewport.current; if (!element) return;
    const measure = () => setWidth(Math.max(1, element.clientWidth - 24));
    const observer = new ResizeObserver(measure); observer.observe(element); measure();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    let loadingTask: ReturnType<typeof pdfjs.getDocument> | undefined;
    setDocument(null); setPageNumber(1); setZoom('fit'); setStatus('loading'); setPageText('');
    pageHost.current?.replaceChildren();
    async function load() {
      try {
        const data = await readPdf(url, controller.signal);
        if (disposed) return;
        // PDF.js 6 removed eval entirely; retain the false flag for older compatible builds.
        const options = { data, withCredentials: true, isEvalSupported: false, enableXfa: false, useSystemFonts: true, useWasm: false, maxImageSize: 16 * 1024 * 1024, canvasMaxAreaInBytes: MAX_CANVAS_PIXELS * 4 };
        loadingTask = pdfjs.getDocument(options);
        const loaded = await loadingTask.promise;
        if (disposed) return;
        if (!loaded.numPages) throw new Error('empty');
        setDocument(loaded);
      } catch (cause) {
        if (!disposed) { setError(cause instanceof Error && cause.message === 'size' ? 'size' : 'failed'); setStatus('error'); }
      }
    }
    void load();
    return () => {
      disposed = true; controller.abort(); renderTask.current?.cancel();
      void loadingTask?.destroy().catch(() => undefined);
    };
  }, [url, retry]);

  useEffect(() => {
    if (!document || !width) return;
    let cancelled = false, page: PDFPageProxy | undefined, task: RenderTask | undefined;
    const host = pageHost.current;
    setStatus('rendering'); setPageText(''); host?.replaceChildren();
    async function draw() {
      try {
        page = await document!.getPage(pageNumber);
        if (cancelled) return;
        const natural = page.getViewport({ scale: 1 });
        const requestedScale = zoom === 'fit' ? width / natural.width : zoom;
        const view = page.getViewport({ scale: requestedScale });
        if (![view.width, view.height].every(n => Number.isFinite(n) && n > 0 && n <= 100_000)) throw new Error('dimensions');
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(MAX_CANVAS_PIXELS / (view.width * view.height)), 4096 / Math.max(view.width, view.height));
        const canvas = window.document.createElement('canvas');
        canvas.className = 'la-pdf-canvas'; canvas.dataset.pdfPage = String(pageNumber);
        canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `${title || t.pdf}: ${t.pdfPageCount.replace('{page}', String(pageNumber)).replace('{pages}', String(document!.numPages))}`);
        canvas.width = Math.max(1, Math.floor(view.width * pixelRatio)); canvas.height = Math.max(1, Math.floor(view.height * pixelRatio));
        canvas.style.width = `${view.width}px`; canvas.style.height = `${view.height}px`;
        task = page.render({ canvas, viewport: view, transform: [pixelRatio, 0, 0, pixelRatio, 0, 0], annotationMode: pdfjs.AnnotationMode.ENABLE });
        renderTask.current = task;
        // Render off-DOM, so rapid page/zoom changes never share a live canvas.
        await task.promise;
        if (cancelled) return;
        host?.replaceChildren(canvas); setScale(requestedScale); setStatus('ready');
        try {
          const text = await page.getTextContent();
          if (!cancelled) setPageText(text.items.map(item => 'str' in item ? item.str : '').join(' ').slice(0, 100_000));
        } catch { /* Canvas remains usable when a PDF has no extractable text. */ }
      } catch {
        if (!cancelled) { setError('failed'); setStatus('error'); }
      } finally { if (page) page.cleanup(); }
    }
    void draw();
    return () => { cancelled = true; task?.cancel(); if (renderTask.current === task) renderTask.current = null; };
  }, [document, pageNumber, width, zoom, title, t.pdf, t.pdfPageCount]);

  function changePage(next: number) {
    if (document && Number.isInteger(next)) { setPageNumber(Math.max(1, Math.min(document.numPages, next))); viewport.current?.scrollTo({ top: 0, left: 0 }); }
  }
  function changeZoom(delta: number) { setZoom(Math.max(0.25, Math.min(3, Math.round((scale + delta) * 100) / 100))); }
  const busy = status === 'loading' || status === 'rendering';
  const controlsDisabled = !document || status === 'error';
  const fallback = /^(\/(?!\/)|https:\/\/)/.test(url) && !/[\u0000-\u0020\\]/.test(url) ? url : undefined;

  return <div className="la la-pdf" data-pdf-state={status}>
    <div className="la-pdf-toolbar" role="group" aria-label={t.pdfControls}>
      <button type="button" className="la-icon" title={t.pdfPrevious} aria-label={t.pdfPrevious} disabled={controlsDisabled || pageNumber <= 1} onClick={() => changePage(pageNumber - 1)}><ChevronLeft size={18}/></button>
      <label className="la-pdf-page-input"><span className="la-pdf-sr">{t.pdfPage}</span><input aria-label={t.pdfPage} type="number" min={1} max={document?.numPages || 1} value={pageNumber} disabled={controlsDisabled} onChange={e => changePage(Number(e.target.value))}/></label>
      <span className="la-pdf-page-count" aria-live="polite">{pageLabel}</span>
      <button type="button" className="la-icon" title={t.pdfNext} aria-label={t.pdfNext} disabled={controlsDisabled || pageNumber >= (document?.numPages || 1)} onClick={() => changePage(pageNumber + 1)}><ChevronRight size={18}/></button>
      <span className="la-pdf-toolbar-spacer"/>
      <button type="button" className="la-icon" title={t.pdfZoomOut} aria-label={t.pdfZoomOut} disabled={controlsDisabled || scale <= 0.25} onClick={() => changeZoom(-0.25)}><ZoomOut size={18}/></button>
      <output className="la-pdf-zoom" aria-label={t.pdfZoom}>{Math.round(scale * 100)}%</output>
      <button type="button" className="la-icon" title={t.pdfZoomIn} aria-label={t.pdfZoomIn} disabled={controlsDisabled || scale >= 3} onClick={() => changeZoom(0.25)}><ZoomIn size={18}/></button>
      <button type="button" className="la-icon" title={t.pdfFit} aria-label={t.pdfFit} aria-pressed={zoom === 'fit'} disabled={controlsDisabled} onClick={() => { setZoom('fit'); viewport.current?.scrollTo({ left: 0 }); }}><Maximize size={18}/></button>
    </div>
    <div ref={viewport} className="la-pdf-viewport" tabIndex={0} role="region" aria-label={title || t.pdf} aria-busy={busy} onKeyDown={e => { if (e.target !== e.currentTarget) return; if (e.key === 'PageDown') { e.preventDefault(); changePage(pageNumber + 1); } else if (e.key === 'PageUp') { e.preventDefault(); changePage(pageNumber - 1); } }}>
      <div ref={pageHost} className="la-pdf-page"/>
      {busy && <p className="la-pdf-status" role="status">{t.loading}</p>}
      {status === 'error' && <div className="la-pdf-status"><p role="alert">{error === 'size' ? t.pdfTooLarge : t.pdfFailed}</p><button type="button" onClick={() => setRetry(n => n + 1)}><RotateCcw size={16}/>{t.pdfRetry}</button></div>}
    </div>
    {pageText && <p className="la-pdf-sr">{pageText}</p>}
    {fallback && <a className="la-pdf-open" href={fallback} target="_blank" rel="noopener noreferrer"><ExternalLink size={16}/>{t.openPdf}</a>}
  </div>;
}
