"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { LoaderCircle, RotateCcw, Upload, X } from "lucide-react";
import type { Banner, PortalContent } from "@/lib/portalContent";
import { otherLocale, translationIsCurrent } from "@/lib/portalContent";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import type { PortalLibraryItem } from "@/lib/portalLibrary";
import { lessonMessages } from "@/messages/lesson-authoring";

const COPY_FIELDS = ["eyebrow", "title", "text", "cta", "href"] as const;
type Operation = { kind: "save" | "translate" | "upload"; controller: AbortController };

export function PortalContentEditor({ initial, locale }: { initial: PortalContent; locale: Locale }) {
  const copy = getMessages(locale).portalEditor;
  const feedback = lessonMessages(locale);
  const [content, setContent] = useState(initial);
  const [source, setSource] = useState<Locale>("en-GB");
  const [library, setLibrary] = useState<PortalLibraryItem[]>([]);
  const [picker, setPicker] = useState<number | null>(null);
  const [pending, setPending] = useState<Operation["kind"] | null>(null);
  const busy = pending !== null;
  const operation = useRef<Operation | null>(null);
  const libraryRequest = useRef<AbortController | null>(null);
  const pickerIndex = useRef<number | null>(null);
  const pickerOpener = useRef<HTMLElement | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const target = otherLocale(source);
  const synced = translationIsCurrent(content, source);

  useEffect(() => () => { operation.current?.controller.abort(); operation.current = null; libraryRequest.current?.abort(); libraryRequest.current = null; }, []);

  useEffect(() => {
    if (picker === null) return;
    const element = dialog.current, opener = pickerOpener.current;
    const overflow = document.body.style.overflow;
    element?.showModal(); document.body.style.overflow = "hidden";
    return () => { element?.close(); document.body.style.overflow = overflow; if (opener?.isConnected) opener.focus(); };
  }, [picker]);

  function begin(kind: Operation["kind"]) {
    if (operation.current) return null;
    const request = { kind, controller: new AbortController() };
    operation.current = request; setPending(kind); setMessage("");
    return request;
  }

  function finish(request: Operation) {
    if (operation.current === request) { operation.current = null; setPending(null); }
  }

  async function loadLibrary() {
    libraryRequest.current?.abort();
    const request = new AbortController(); libraryRequest.current = request;
    setLibraryLoading(true); setLibraryError("");
    try {
      const response = await fetch("/api/backoffice/portal/media", { signal: request.signal, cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !Array.isArray(result.library)) throw new Error(result.error || feedback.mediaFailed);
      if (libraryRequest.current === request && !request.signal.aborted) setLibrary(result.library);
    } catch (caught) {
      if (!request.signal.aborted && libraryRequest.current === request) setLibraryError(caught instanceof Error ? caught.message : feedback.mediaFailed);
    } finally {
      if (libraryRequest.current === request) { libraryRequest.current = null; setLibraryLoading(false); }
    }
  }

  function openPicker(index: number) {
    if (operation.current || pickerIndex.current !== null) return;
    pickerOpener.current = document.activeElement as HTMLElement | null;
    pickerIndex.current = index; setPicker(index); setUploadError(""); void loadLibrary();
  }

  function closePicker() {
    libraryRequest.current?.abort(); libraryRequest.current = null; setLibraryLoading(false);
    if (operation.current?.kind === "upload") { operation.current.controller.abort(); operation.current = null; setPending(null); }
    pickerIndex.current = null; setPicker(null);
  }

  function setBannerImage(index: number, url: string) {
    setContent((current) => ({
      ...current,
      banners: {
        "en-GB": current.banners["en-GB"].map((banner, i) => i === index ? { ...banner, image: url } : banner),
        "zh-CN": current.banners["zh-CN"].map((banner, i) => i === index ? { ...banner, image: url } : banner)
      }
    }));
  }

  function editBanner(language: Locale, index: number, key: (typeof COPY_FIELDS)[number], value: string) {
    setContent((current) => ({
      ...current,
      banners: {
        ...current.banners,
        [language]: current.banners[language].map((banner, i) => i === index ? { ...banner, [key]: value } : banner)
      }
    }));
  }

  function editCategory(language: Locale, index: number, value: string) {
    setContent((current) => ({
      ...current,
      categories: current.categories.map((item, i) => i === index ? { ...item, labels: { ...item.labels, [language]: value } } : item)
    }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (pickerIndex.current !== null) return;
    const request = begin("save"); if (!request) return;
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/backoffice/portal", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(content), signal: request.controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (operation.current !== request || request.controller.signal.aborted) return;
      setContent(result.content);
      setMessage(copy.saved);
    } catch (caught) {
      if (!request.controller.signal.aborted) setError(caught instanceof Error ? caught.message : copy.failed);
    } finally {
      finish(request);
    }
  }

  async function translate() {
    if (pickerIndex.current !== null) return;
    const request = begin("translate"); if (!request) return;
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/backoffice/portal/translate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source, content }), signal: request.controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (operation.current !== request || request.controller.signal.aborted) return;
      setContent(result.content);
      setMessage(result.skipped ? copy.alreadyTranslated : copy.translated);
    } catch (caught) {
      if (!request.controller.signal.aborted) setError(caught instanceof Error ? caught.message : copy.translateFailed);
    } finally {
      finish(request);
    }
  }

  async function upload(file: File) {
    const index = pickerIndex.current;
    if (index === null) return;
    const request = begin("upload"); if (!request) return;
    libraryRequest.current?.abort(); libraryRequest.current = null; setLibraryLoading(false);
    setUploadError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/backoffice/portal/media", { method: "POST", body, signal: request.controller.signal });
      const result = await response.json();
      if (!response.ok || !result.asset?.url) throw new Error(result.error || feedback.uploadFailed);
      if (request.controller.signal.aborted || operation.current !== request || pickerIndex.current !== index) return;
      if (Array.isArray(result.library)) setLibrary(result.library);
      setBannerImage(index, result.asset.url);
      finish(request); closePicker();
    } catch (caught) {
      if (!request.controller.signal.aborted && operation.current === request) setUploadError(caught instanceof Error ? caught.message : feedback.uploadFailed);
    } finally {
      if (operation.current === request) { finish(request); if (fileInput.current) fileInput.current.value = ""; }
    }
  }

  function fieldInput(language: Locale, banner: Banner, index: number, key: (typeof COPY_FIELDS)[number]) {
    const value = banner[key];
    const label = copy[key];
    if (key === "text") {
      return <label key={key}>{label}<textarea required rows={3} value={value} onChange={(event) => editBanner(language, index, key, event.target.value)} /></label>;
    }
    return <label key={key}>{label}<input required value={value} onChange={(event) => editBanner(language, index, key, event.target.value)} /></label>;
  }

  return <form onSubmit={save} onChange={() => setMessage("")} className="portal-content-editor" aria-busy={pending === "save" || pending === "translate"}>
    <h1>{copy.heading}</h1>
    <p className="portal-lead">{copy.intro}</p>
    <fieldset className="portal-cms-fields" disabled={busy || picker !== null}>
    <div className="portal-i18n-toolbar">
      <label>{copy.sourceLanguage}
        <select value={source} onChange={(event) => setSource(event.target.value as Locale)}>
          <option value="en-GB">{copy.english}</option>
          <option value="zh-CN">{copy.chinese}</option>
        </select>
      </label>
      <button className="portal-button" type="button" disabled={busy || synced} onClick={() => void translate()}>{pending === "translate" ? copy.translating : copy.translateOnce}</button>
    </div>
    {content.banners[source].map((banner, index) => {
      const other = content.banners[target][index];
      return <fieldset key={index}>
        <legend>{copy.banner} {index + 1}</legend>
        <div className="portal-banner-preview" style={{ backgroundImage: `linear-gradient(90deg, rgba(10, 26, 50, .78), rgba(10, 26, 50, .18)), url(${banner.image})` }}>
          <p className="portal-eyebrow">{banner.eyebrow || copy.preview}</p>
          <strong>{banner.title || copy.title}</strong>
        </div>
        <label>{copy.sharedImage}
          <div className="portal-image-picker-row">
            <input required value={banner.image} onChange={(event) => setBannerImage(index, event.target.value)} />
            <button className="portal-button" type="button" onClick={() => openPicker(index)}>{copy.chooseImage}</button>
          </div>
        </label>
        <div className="portal-i18n-grid">
          <div>
            <h2>{source === "en-GB" ? copy.english : copy.chinese}</h2>
            {COPY_FIELDS.map((key) => fieldInput(source, banner, index, key))}
          </div>
          <div>
            <h2>{target === "en-GB" ? copy.english : copy.chinese}</h2>
            {COPY_FIELDS.map((key) => fieldInput(target, other, index, key))}
          </div>
        </div>
      </fieldset>;
    })}
    <fieldset>
      <legend>{copy.categories}</legend>
      {content.categories.map((category, index) => <div key={category.id} className="portal-i18n-grid">
        <label>{category.id} · {copy.english}<input required value={category.labels["en-GB"]} onChange={(event) => editCategory("en-GB", index, event.target.value)} /></label>
        <label>{category.id} · {copy.chinese}<input required value={category.labels["zh-CN"]} onChange={(event) => editCategory("zh-CN", index, event.target.value)} /></label>
      </div>)}
    </fieldset>
    <label>{copy.countries}<textarea value={content.countries.join("\n")} rows={8} onChange={(event) => setContent({ ...content, countries: event.target.value.split("\n") })} /></label>
    <label>{copy.support}<input value={content.supportUrl} onChange={(event) => setContent({ ...content, supportUrl: event.target.value })} /></label>
    {error ? <p role="alert" className="portal-form-error">{error}</p> : null}
    {message ? <p role="status">{message}</p> : null}
    <button className="portal-button portal-button-primary" type="submit" disabled={busy}>{pending === "save" ? copy.saving : copy.save}</button>
    </fieldset>
    {picker !== null ? <dialog ref={dialog} className="portal-image-library-dialog" aria-label={copy.library} onCancel={event => { event.preventDefault(); closePicker(); }}>
      <div className="portal-image-library-panel">
        <header>
          <h2>{copy.library}</h2>
          <button className="portal-button portal-cms-icon" type="button" title={copy.closeLibrary} aria-label={copy.closeLibrary} autoFocus onClick={closePicker}><X size={20}/></button>
        </header>
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
        <button className="portal-button portal-button-primary" type="button" disabled={busy} onClick={() => fileInput.current?.click()}>{pending === "upload" ? <LoaderCircle size={18} className="portal-cms-spinner"/> : <Upload size={18}/>} {pending === "upload" ? feedback.uploading : copy.uploadImage}</button>
        {uploadError && <p role="alert" className="portal-form-error">{uploadError}</p>}
        {libraryLoading && <p role="status"><LoaderCircle size={18} className="portal-cms-spinner"/> {feedback.loading}</p>}
        {libraryError && <div className="portal-cms-library-error"><p role="alert" className="portal-form-error">{libraryError}</p><button className="portal-button" type="button" disabled={busy} onClick={() => void loadLibrary()}><RotateCcw size={18}/>{feedback.pdfRetry}</button></div>}
        <div className="portal-image-library-grid">
          {library.map((item) => <button
            key={item.id}
            type="button"
            disabled={busy}
            className={content.banners[source][picker].image === item.url ? "active" : ""}
            aria-pressed={content.banners[source][picker].image === item.url}
            title={item.fileName}
            style={{ backgroundImage: `url(${item.url})` }}
            onClick={() => { if (operation.current) return; setBannerImage(picker, item.url); closePicker(); }}
          ><span>{item.fileName}</span></button>)}
        </div>
      </div>
    </dialog> : null}
  </form>;
}
