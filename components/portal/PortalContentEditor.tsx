"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Banner, PortalContent } from "@/lib/portalContent";
import { otherLocale, translationIsCurrent } from "@/lib/portalContent";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import type { PortalLibraryItem } from "@/lib/portalLibrary";

const COPY_FIELDS = ["eyebrow", "title", "text", "cta", "href"] as const;

export function PortalContentEditor({ initial, locale }: { initial: PortalContent; locale: Locale }) {
  const copy = getMessages(locale).portalEditor;
  const [content, setContent] = useState(initial);
  const [source, setSource] = useState<Locale>("en-GB");
  const [library, setLibrary] = useState<PortalLibraryItem[]>([]);
  const [picker, setPicker] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const target = otherLocale(source);
  const synced = translationIsCurrent(content, source);

  useEffect(() => {
    void fetch("/api/backoffice/portal/media")
      .then((response) => response.json())
      .then((result) => { if (Array.isArray(result.library)) setLibrary(result.library); })
      .catch(() => undefined);
  }, []);

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
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/backoffice/portal", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(content) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setContent(result.content);
      setMessage(copy.saved);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.failed);
    } finally {
      setBusy(false);
    }
  }

  async function translate() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/backoffice/portal/translate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source, content }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setContent(result.content);
      setMessage(result.skipped ? copy.alreadyTranslated : copy.translated);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.translateFailed);
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/backoffice/portal/media", { method: "POST", body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (Array.isArray(result.library)) setLibrary(result.library);
      if (picker !== null && result.asset?.url) {
        setBannerImage(picker, result.asset.url);
        setPicker(null);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.failed);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
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

  return <form onSubmit={save} className="portal-content-editor">
    <h1>{copy.heading}</h1>
    <p className="portal-lead">{copy.intro}</p>
    <div className="portal-i18n-toolbar">
      <label>{copy.sourceLanguage}
        <select value={source} onChange={(event) => setSource(event.target.value as Locale)}>
          <option value="en-GB">{copy.english}</option>
          <option value="zh-CN">{copy.chinese}</option>
        </select>
      </label>
      <button className="portal-button" type="button" disabled={busy || synced} onClick={() => void translate()}>{busy ? copy.translating : copy.translateOnce}</button>
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
            <button className="portal-button" type="button" onClick={() => setPicker(index)}>{copy.chooseImage}</button>
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
    <button className="portal-button portal-button-primary" disabled={busy}>{busy ? copy.saving : copy.save}</button>
    {picker !== null ? <div className="portal-image-library-overlay" role="dialog" aria-modal="true" aria-label={copy.library}>
      <div className="portal-image-library-panel">
        <header>
          <h2>{copy.library}</h2>
          <button className="portal-button" type="button" onClick={() => setPicker(null)}>{copy.closeLibrary}</button>
        </header>
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
        <button className="portal-button portal-button-primary" type="button" onClick={() => fileInput.current?.click()}>{copy.uploadImage}</button>
        <div className="portal-image-library-grid">
          {library.map((item) => <button
            key={item.id}
            type="button"
            className={content.banners[source][picker].image === item.url ? "active" : ""}
            aria-pressed={content.banners[source][picker].image === item.url}
            title={item.fileName}
            style={{ backgroundImage: `url(${item.url})` }}
            onClick={() => { setBannerImage(picker, item.url); setPicker(null); }}
          ><span>{item.fileName}</span></button>)}
        </div>
      </div>
    </div> : null}
  </form>;
}
