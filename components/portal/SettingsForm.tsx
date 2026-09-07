"use client";

import { FormEvent, useState } from "react";

type Copy = {
  avatar: string; uploadAvatar: string; removeAvatar: string; nickname: string; email: string; language: string; english: string; chinese: string;
  country: string; countryPlaceholder: string; ageRange: string; agePlaceholder: string; education: string; educationPlaceholder: string;
  areasOfInterest: string; areasHint: string; deviceManagement: string; emailNotifications: string; currentPassword: string; newPassword: string;
  confirmPassword: string; save: string; saved: string;
};

const countries = ["Australia", "Canada", "China", "France", "Germany", "Hong Kong SAR", "Ireland", "Singapore", "United Kingdom", "United States"];
const ageRanges = ["Under 18", "18–24", "25–34", "35–44", "45–54", "55–64", "65+"];
const educationLevels = ["Secondary education", "Undergraduate", "Postgraduate", "Doctorate", "Other"];
const interestOptions = ["Humanities", "Science", "History", "Philosophy", "Mathematics", "Literature", "Arts"];

async function squareAvatar(file: File) {
  const source = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => { const value = new Image(); value.onload = () => resolve(value); value.onerror = reject; value.src = source; });
    const size = Math.min(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = 600; canvas.height = 600;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(image, (image.naturalWidth - size) / 2, (image.naturalHeight - size) / 2, size, size, 0, 0, 600, 600);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", .9));
    return blob ? new File([blob], "avatar.jpg", { type: "image/jpeg" }) : file;
  } finally { URL.revokeObjectURL(source); }
}

export function SettingsForm({ initialNickname, initialEmail, initialLocale, initialCountry, initialAgeRange, initialEducation, initialAreasOfInterest, hasAvatar, copy }: { initialNickname: string; initialEmail: string; initialLocale: "en-GB" | "zh-CN"; initialCountry?: string | null; initialAgeRange?: string | null; initialEducation?: string | null; initialAreasOfInterest?: string[]; hasAvatar: boolean; copy: Copy }) {
  const [nickname, setNickname] = useState(initialNickname);
  const [locale, setLocale] = useState(initialLocale);
  const [country, setCountry] = useState(initialCountry || "");
  const [ageRange, setAgeRange] = useState(initialAgeRange || "");
  const [education, setEducation] = useState(initialEducation || "");
  const [areasOfInterest, setAreasOfInterest] = useState(initialAreasOfInterest || []);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [avatar, setAvatar] = useState(hasAvatar);
  const [avatarError, setAvatarError] = useState("");

  async function uploadAvatar(file: File | undefined) {
    if (!file) return;
    setAvatarError("");
    if (file.size > 5 * 1024 * 1024) { setAvatarError("The image must be 5 MB or smaller."); return; }
    try {
      const prepared = await squareAvatar(file);
      const form = new FormData(); form.set("file", prepared);
      const response = await fetch("/api/my-learning/avatar", { method: "POST", body: form });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Image upload failed.");
      setAvatar(true);
    } catch (requestError) { setAvatarError(requestError instanceof Error ? requestError.message : "Image upload failed."); }
  }

  async function removeAvatar() {
    setAvatarError("");
    const response = await fetch("/api/my-learning/avatar", { method: "DELETE" });
    const data = await response.json() as { ok?: boolean; error?: string };
    if (!response.ok || !data.ok) { setAvatarError(data.error || "Image removal failed."); return; }
    setAvatar(false);
  }

  function toggleInterest(value: string) {
    setAreasOfInterest((current) => current.includes(value) ? current.filter((item) => item !== value) : current.length < 5 ? [...current, value] : current);
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setMessage(""); setError("");
    if (newPassword !== confirmPassword) { setError("New passwords do not match."); return; }
    if (!country) { setError("Country is required."); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/me/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nickname, locale, country, ageRange, education, areasOfInterest, currentPassword, newPassword }) });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Settings update failed.");
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); setMessage(copy.saved);
      if (locale !== initialLocale) window.location.assign(`/${locale}/account/my-learning/settings`);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Settings update failed."); }
    finally { setBusy(false); }
  }

  const initial = (nickname.trim()[0] || "L").toUpperCase();
  return <form className="portal-form settings-form" onSubmit={submit}>
    <div className="avatar-settings"><div className="avatar-preview">{avatar ? <img src="/api/my-learning/avatar" alt={copy.avatar} /> : <span aria-hidden="true">{initial}</span>}</div><div><strong>{copy.avatar}</strong><p className="settings-hint">JPG, PNG or WebP · 5 MB maximum · square crop</p><div className="backoffice-row-actions"><label className="portal-button portal-button-secondary avatar-upload">{copy.uploadAvatar}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void uploadAvatar(event.target.files?.[0])} /></label>{avatar ? <button className="portal-button portal-button-secondary" onClick={() => void removeAvatar()} type="button">{copy.removeAvatar}</button> : null}</div></div></div>
    {avatarError ? <p className="portal-form-error" role="alert">{avatarError}</p> : null}
    <label>{copy.email}<input value={initialEmail} readOnly disabled /></label>
    <label>{copy.nickname}<input value={nickname} onChange={(event) => setNickname(event.target.value)} minLength={2} maxLength={30} required /></label>
    <div className="settings-grid"><label>{copy.country}<select value={country} onChange={(event) => setCountry(event.target.value)} required><option value="">{copy.countryPlaceholder}</option>{countries.map((item) => <option key={item}>{item}</option>)}</select></label><label>{copy.ageRange}<select value={ageRange} onChange={(event) => setAgeRange(event.target.value)}><option value="">{copy.agePlaceholder}</option>{ageRanges.map((item) => <option key={item}>{item}</option>)}</select></label><label>{copy.education}<select value={education} onChange={(event) => setEducation(event.target.value)}><option value="">{copy.educationPlaceholder}</option>{educationLevels.map((item) => <option key={item}>{item}</option>)}</select></label><label>{copy.language}<select value={locale} onChange={(event) => setLocale(event.target.value as "en-GB" | "zh-CN")}><option value="en-GB">{copy.english}</option><option value="zh-CN">{copy.chinese}</option></select></label></div>
    <fieldset className="settings-interests"><legend>{copy.areasOfInterest}</legend><p className="settings-hint">{copy.areasHint}</p><div className="interest-options">{interestOptions.map((item) => <label key={item}><input type="checkbox" checked={areasOfInterest.includes(item)} onChange={() => toggleInterest(item)} />{item}</label>)}</div></fieldset>
    <div className="settings-disabled-options"><label><input type="checkbox" disabled />{copy.deviceManagement}</label><label><input type="checkbox" disabled />{copy.emailNotifications}</label></div>
    <div className="settings-password"><h2>{copy.newPassword}</h2><label>{copy.currentPassword}<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" /></label><label>{copy.newPassword}<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={8} autoComplete="new-password" /></label><label>{copy.confirmPassword}<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={8} autoComplete="new-password" /></label></div>
    {error ? <p className="portal-form-error" role="alert">{error}</p> : null}{message ? <p className="portal-success" role="status">{message}</p> : null}<button className="portal-button portal-button-primary" disabled={busy}>{busy ? "..." : copy.save}</button>
  </form>;
}
