"use client";

import { useEffect, useRef, useState } from 'react';
import { avatarCrop, croppedAvatar } from '@/lib/avatarCrop';
import { getMessages } from '@/lib/i18n/messages';

export function AvatarCropper({ file, locale, onSave, onCancel }: { file: File; locale: 'en-GB' | 'zh-CN'; onSave: (file: File) => Promise<void>; onCancel: () => void }) {
  const copy = getMessages(locale).settingsDesign;
  const dialog = useRef<HTMLDialogElement>(null), image = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  const [source, setSource] = useState(''), [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1), [x, setX] = useState(50), [y, setY] = useState(50);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    const url = URL.createObjectURL(file); setSource(url);
    dialog.current?.showModal();
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const crop = avatarCrop(dimensions.width, dimensions.height, zoom, x, y);
  async function save() {
    if (!image.current || !dimensions.width) return;
    setBusy(true); setError('');
    try { await onSave(await croppedAvatar(image.current, zoom, x, y)); }
    catch { setError(copy.imageUploadError); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="avatar-crop-dialog" aria-labelledby="avatar-crop-title" onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <h2 id="avatar-crop-title">{copy.cropTitle}</h2><p>{copy.cropHint}</p>
    <div className="avatar-crop-stage" onPointerDown={event => { if (busy) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x, y, startX: event.clientX, startY: event.clientY }; }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onPointerMove={event => {
      const start = drag.current; if (!start || !crop.size) return;
      const scale = crop.size / event.currentTarget.getBoundingClientRect().width;
      if (dimensions.width > crop.size) setX(Math.max(0, Math.min(100, start.x - (event.clientX - start.startX) * scale / (dimensions.width - crop.size) * 100)));
      if (dimensions.height > crop.size) setY(Math.max(0, Math.min(100, start.y - (event.clientY - start.startY) * scale / (dimensions.height - crop.size) * 100)));
    }}>
      {source && <img ref={image} src={source} alt={copy.cropPreview} draggable={false} onLoad={event => setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} onError={() => setError(copy.cropReadError)} style={crop.size ? { width: `${dimensions.width / crop.size * 100}%`, height: `${dimensions.height / crop.size * 100}%`, left: `${-crop.x / crop.size * 100}%`, top: `${-crop.y / crop.size * 100}%` } : { visibility: 'hidden' }} />}
      <span className="avatar-crop-mask" aria-hidden="true" />
    </div>
    <label>{copy.cropZoom}<input type="range" min="1" max="3" step="0.01" value={zoom} disabled={busy} onChange={event => setZoom(Number(event.target.value))} /></label>
    <label>{copy.cropHorizontal}<input type="range" min="0" max="100" value={x} disabled={busy || dimensions.width === crop.size} onChange={event => setX(Number(event.target.value))} /></label>
    <label>{copy.cropVertical}<input type="range" min="0" max="100" value={y} disabled={busy || dimensions.height === crop.size} onChange={event => setY(Number(event.target.value))} /></label>
    {error && <p role="alert" className="portal-form-error">{error}</p>}
    <div className="backoffice-row-actions"><button type="button" className="portal-button portal-button-secondary" disabled={busy} onClick={onCancel}>{copy.cropCancel}</button><button type="button" className="portal-button portal-button-primary" disabled={busy || !dimensions.width} onClick={() => void save()}>{busy ? copy.cropSaving : copy.cropSave}</button></div>
  </dialog>;
}
