"use client";

import { FormEvent, useEffect, useState } from "react";
import { getMessages } from "@/lib/i18n/messages";

type Copy = {
  avatar: string; uploadAvatar: string; removeAvatar: string; nickname: string; email: string; language: string; english: string; chinese: string;
  country: string; countryPlaceholder: string; ageRange: string; agePlaceholder: string; education: string; educationPlaceholder: string;
  areasOfInterest: string; areasHint: string; deviceManagement: string; emailNotifications: string; currentPassword: string; newPassword: string;
  confirmPassword: string; save: string; saved: string;
};


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

export function SettingsForm({ countries, uiLocale, initialNickname, initialEmail, initialLocale, initialCountry, initialAgeRange, initialEducation, initialAreasOfInterest, hasAvatar, copy }: { countries: string[]; uiLocale: "en-GB" | "zh-CN"; initialNickname: string; initialEmail: string; initialLocale: "en-GB" | "zh-CN"; initialCountry?: string | null; initialAgeRange?: string | null; initialEducation?: string | null; initialAreasOfInterest?: string[]; hasAvatar: boolean; copy: Copy }) {
  const design = getMessages(uiLocale).settingsDesign;
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
  const [avatarVersion, setAvatarVersion] = useState(0);
  useEffect(() => {
    if (initialCountry) return;
    const regions: Record<string, string> = { AU: "Australia", CA: "Canada", CN: "China", FR: "France", DE: "Germany", HK: "Hong Kong SAR", IE: "Ireland", SG: "Singapore", GB: "United Kingdom", US: "United States" };
    const region = navigator.language.split("-").slice(-1)[0].toUpperCase();
    if (regions[region] && countries.includes(regions[region])) setCountry(regions[region]);
  }, [initialCountry, countries]);

  async function uploadAvatar(file: File | undefined) {
    if (!file) return;
    setAvatarError("");
    if (!["image/jpeg", "image/png"].includes(file.type)) { setAvatarError(design.imageTypeError); return; }
    if (file.size > 5 * 1024 * 1024) { setAvatarError(design.imageSizeError); return; }
    try {
      const prepared = await squareAvatar(file);
      const form = new FormData(); form.set("file", prepared);
      const response = await fetch("/api/my-learning/avatar", { method: "POST", body: form });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || design.imageUploadError);
      setAvatar(true); setAvatarVersion(Date.now());
    } catch (requestError) { setAvatarError(requestError instanceof Error ? requestError.message : design.imageUploadError); }
  }

  async function removeAvatar() {
    setAvatarError("");
    try {
      const response = await fetch("/api/my-learning/avatar", { method: "DELETE" });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || design.imageRemoveError);
      setAvatar(false);
    } catch (requestError) {
      setAvatarError(requestError instanceof Error ? requestError.message : design.imageRemoveError);
    }
  }


  async function submit(event: FormEvent) {
    event.preventDefault(); setMessage(""); setError("");
    if (newPassword !== confirmPassword) { setError(design.passwordMismatch); return; }
    if (!country) { setError(design.countryRequired); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/me/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nickname, locale, country, ageRange, education, areasOfInterest, currentPassword, newPassword }) });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || design.saveError);
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); setMessage(copy.saved);
      if (locale !== initialLocale) window.location.assign(`/${locale}/account/my-learning/settings`);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : design.saveError); }
    finally { setBusy(false); }
  }

  const initial = (nickname.trim()[0] || "L").toUpperCase();
  return <form className="portal-form settings-form settings-design-form" onSubmit={submit}>
    <section className="settings-design-section settings-profile-section" aria-labelledby="settings-profile-heading">
      <h2 id="settings-profile-heading">{design.profile}</h2>
      <p className="settings-section-intro">{design.profileIntro}</p>
      <div className="settings-profile-grid">
        <div className="avatar-settings">
          <div className="avatar-preview">{avatar ? <img src={`/api/my-learning/avatar?v=${avatarVersion}`} alt={copy.avatar} /> : <span aria-hidden="true">{initial}</span>}</div>
          <div><div className="backoffice-row-actions"><label className="portal-button portal-button-secondary avatar-upload">{copy.uploadAvatar}<input type="file" aria-label={copy.uploadAvatar} accept="image/jpeg,image/png" onChange={(event) => void uploadAvatar(event.target.files?.[0])} /></label>{avatar ? <button className="portal-button portal-button-secondary" onClick={() => void removeAvatar()} type="button">{copy.removeAvatar}</button> : null}</div><p className="settings-hint">{design.avatarRules}</p></div>
        </div>
        <div className="settings-profile-fields">
          <label>{copy.nickname}<input value={nickname} onChange={(event) => setNickname(event.target.value)} minLength={2} maxLength={30} pattern="[A-Za-z0-9 ]{2,30}" required /></label>
          <label>{copy.email}<input value={initialEmail} readOnly disabled /></label>
        </div>
      </div>
      {avatarError ? <p className="portal-form-error" role="alert">{avatarError}</p> : null}
    </section>
    <section className="settings-design-section settings-details-section" aria-labelledby="settings-details-heading">
      <h2 id="settings-details-heading">{design.personalDetails}</h2>
      <p className="settings-section-intro">{design.detailsIntro}</p>
      <div className="settings-details-grid">
        <label>{copy.country}<select aria-label={copy.country} value={country} onChange={(event) => setCountry(event.target.value)} required><option value="">{copy.countryPlaceholder}</option>{countries.map((item) => <option key={item}>{item}</option>)}</select></label>
        <div className="settings-interest-field">
          <span id="settings-interests-label">{copy.areasOfInterest}</span>
          <details className="settings-interest-menu"><summary aria-labelledby="settings-interests-label">{areasOfInterest.length ? areasOfInterest.map((item) => design.interestLabels[interestOptions.indexOf(item)] || item).join(" · ") : copy.areasHint}</summary>
            <fieldset><legend className="sr-only">{copy.areasOfInterest}</legend>{interestOptions.map((item, index) => <label key={item}><input type="checkbox" checked={areasOfInterest.includes(item)} disabled={areasOfInterest.length >= 5 && !areasOfInterest.includes(item)} onChange={(event) => setAreasOfInterest((selected) => event.target.checked ? [...selected, item].slice(0, 5) : selected.filter((value) => value !== item))} />{design.interestLabels[index]}</label>)}</fieldset>
          </details>
        </div>
        <label>{copy.ageRange}<select aria-label={copy.ageRange} value={ageRange} onChange={(event) => setAgeRange(event.target.value)}><option value="">{copy.agePlaceholder}</option>{ageRanges.map((item, index) => <option key={item} value={item}>{design.ageLabels[index]}</option>)}</select></label>
        <label>{copy.education}<select aria-label={copy.education} value={education} onChange={(event) => setEducation(event.target.value)}><option value="">{copy.educationPlaceholder}</option>{educationLevels.map((item, index) => <option key={item} value={item}>{design.educationLabels[index]}</option>)}</select></label>
      </div>
    </section>
    <section className="settings-design-section settings-disabled-section" aria-labelledby="settings-device-heading">
      <h2 id="settings-device-heading">{copy.deviceManagement}</h2>
      <div className="settings-disabled-options"><label><input type="checkbox" disabled />{copy.deviceManagement}</label></div>
    </section>
    <section className="settings-design-section settings-disabled-section" aria-labelledby="settings-email-heading">
      <h2 id="settings-email-heading">{copy.emailNotifications}</h2>
      <div className="settings-disabled-options"><label><input type="checkbox" disabled />{copy.emailNotifications}</label></div>
    </section>
    <section className="settings-design-section" aria-labelledby="settings-preferences-heading">
      <h2 id="settings-preferences-heading">{copy.language}</h2>
      <label><span className="sr-only">{copy.language}</span><select value={locale} onChange={(event) => setLocale(event.target.value as "en-GB" | "zh-CN")}><option value="en-GB">{copy.english}</option><option value="zh-CN">{copy.chinese}</option></select></label>
    </section>
    <section className="settings-design-section settings-password" aria-labelledby="settings-password-heading">
      <h2 id="settings-password-heading">{copy.newPassword}</h2>
      <div className="settings-details-grid">
        <label>{copy.currentPassword}<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" /></label>
        <label>{copy.newPassword}<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={8} autoComplete="new-password" /></label>
        <label>{copy.confirmPassword}<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={8} autoComplete="new-password" /></label>
      </div>
    </section>
    {error ? <p className="portal-form-error" role="alert">{error}</p> : null}{message ? <p className="portal-success" role="status">{message}</p> : null}
    <div className="settings-save-row"><button className="portal-button portal-button-primary" disabled={busy}>{busy ? "..." : copy.save}</button></div>
  </form>;
}
