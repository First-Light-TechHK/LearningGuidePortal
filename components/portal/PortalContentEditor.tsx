"use client";
import { useState, type FormEvent } from "react";
import type { PortalContent, Banner } from "@/lib/portalContent";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";

export function PortalContentEditor({ initial, locale }: { initial: PortalContent; locale: Locale }) {
  const copy = getMessages(locale).portalEditor;
  const [content, setContent] = useState(initial);
  const [language, setLanguage] = useState<Locale>(locale);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  function edit(index: number, key: keyof Banner, value: string) {
    setContent((current) => ({ ...current, banners: { ...current.banners, [language]: current.banners[language].map((banner, i) => i === index ? { ...banner, [key]: value } : banner) } }));
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/backoffice/portal", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(content) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setContent(result.content); setMessage(copy.saved);
    } catch (error) { setError(error instanceof Error ? error.message : copy.failed); }
    finally { setBusy(false); }
  }
  return <form onSubmit={save} className="portal-content-editor">
    <h1>{copy.heading}</h1>
    <label>{copy.language}<select value={language} onChange={(event) => setLanguage(event.target.value as Locale)}><option value="en-GB">English (UK)</option><option value="zh-CN">简体中文</option></select></label>
    {content.banners[language].map((banner, index) => <fieldset key={index}><legend>{copy.banner} {index + 1}</legend><div className="settings-grid">{(["image", "eyebrow", "title", "text", "cta", "href"] as const).map((key) => <label key={key}>{copy[key]}<input required value={banner[key]} onChange={(event) => edit(index, key, event.target.value)} /></label>)}</div></fieldset>)}
    <fieldset><legend>{copy.categories}</legend>{content.categories.map((category, index) => <label key={category.id}>{category.id}<input value={category.labels[language]} required onChange={(event) => setContent({ ...content, categories: content.categories.map((item, i) => i === index ? { ...item, labels: { ...item.labels, [language]: event.target.value } } : item) })} /></label>)}</fieldset>
    <label>{copy.countries}<textarea value={content.countries.join("\n")} rows={8} onChange={(event) => setContent({ ...content, countries: event.target.value.split("\n") })} /></label>
    <label>{copy.support}<input value={content.supportUrl} onChange={(event) => setContent({ ...content, supportUrl: event.target.value })} /></label>
    {error ? <p role="alert" className="portal-form-error">{error}</p> : null}{message ? <p role="status">{message}</p> : null}
    <button className="portal-button portal-button-primary" disabled={busy}>{busy ? copy.saving : copy.save}</button>
  </form>;
}
