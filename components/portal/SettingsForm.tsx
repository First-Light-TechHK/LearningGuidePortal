"use client";

import { FormEvent, useEffect, useState } from "react";
import { ConfigProvider, Input, Select } from "antd";
import { PortalProvider } from "./ui/PortalProvider";
import { PortalButton } from "./ui/PortalButton";
import styles from "./settings-form-controls.module.css";
import { getMessages } from "@/lib/i18n/messages";
import { AvatarCropper } from './AvatarCropper';
import { isNameTooLong, isValidAccountName, normaliseName, normalisePastedName } from "@/lib/nameValidation";

type Copy = {
  avatar: string; uploadAvatar: string; removeAvatar: string; nickname: string; email: string; language: string; english: string; chinese: string;
  country: string; countryPlaceholder: string; ageRange: string; agePlaceholder: string; education: string; educationPlaceholder: string;
  areasOfInterest: string; areasHint: string; deviceManagement: string; emailNotifications: string; currentPassword: string; newPassword: string;
  confirmPassword: string; save: string; saved: string;
};


const ageRanges = ["Under 18", "18–24", "25–34", "35–44", "45–54", "55–64", "65+"];
const educationLevels = ["Secondary education", "Undergraduate", "Postgraduate", "Doctorate", "Other"];
const interestOptions = ["Humanities", "Science", "History", "Philosophy", "Mathematics", "Literature", "Arts"];

export function SettingsForm({ countries, uiLocale, initialNickname, initialEmail, initialLocale, initialCountry, initialAgeRange, initialEducation, initialAreasOfInterest, hasAvatar, copy }: { countries: string[]; uiLocale: "en-GB" | "zh-CN"; initialNickname: string; initialEmail: string; initialLocale: "en-GB" | "zh-CN"; initialCountry?: string | null; initialAgeRange?: string | null; initialEducation?: string | null; initialAreasOfInterest?: string[]; hasAvatar: boolean; copy: Copy }) {
  const design = getMessages(uiLocale).settingsDesign;
  const nameCopy = getMessages(uiLocale).auth;
  const [nickname, setNickname] = useState(initialNickname);
  const [locale, setLocale] = useState(initialLocale);
  const [country, setCountry] = useState(initialCountry || "");
  const [ageRange, setAgeRange] = useState(initialAgeRange || "");
  const [education, setEducation] = useState(initialEducation || "");
  const [areasOfInterest, setAreasOfInterest] = useState(initialAreasOfInterest || []);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [avatar, setAvatar] = useState(hasAvatar);
  const [avatarError, setAvatarError] = useState("");
  const [avatarVersion, setAvatarVersion] = useState(0);
  const [cropFile, setCropFile] = useState<File | null>(null);
  useEffect(() => {
    if (initialCountry) return;
    const regions: Record<string, string> = { AU: "Australia", CA: "Canada", CN: "China", FR: "France", DE: "Germany", HK: "Hong Kong SAR", IE: "Ireland", SG: "Singapore", GB: "United Kingdom", US: "United States" };
    const region = navigator.language.split("-").slice(-1)[0].toUpperCase();
    if (regions[region] && countries.includes(regions[region])) setCountry(regions[region]);
  }, [initialCountry, countries]);

  function selectAvatar(file: File | undefined) {
    if (!file) return;
    setAvatarError("");
    if (!["image/jpeg", "image/png"].includes(file.type)) { setAvatarError(design.imageTypeError); return; }
    if (file.size > 5 * 1024 * 1024) { setAvatarError(design.imageSizeError); return; }
    setCropFile(file);
  }

  async function uploadAvatar(file: File) {
      const form = new FormData(); form.set("file", file);
      const response = await fetch("/api/my-learning/avatar", { method: "POST", body: form });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(design.imageUploadError);
      setAvatar(true); setAvatarVersion(Date.now());
      setCropFile(null);
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
    if (!isValidAccountName(nickname)) { setError(isNameTooLong(nickname) ? nameCopy.nameTooLong : nameCopy.nameInvalid); return; }
    if (!country) { setError(design.countryRequired); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/me/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nickname: normaliseName(nickname), locale, country, ageRange, education, areasOfInterest }) });
      const data = await response.json() as { ok?: boolean; code?: string };
      if (!response.ok || !data.ok) throw new Error(data.code === "CURRENT_PASSWORD_INCORRECT" ? design.currentPasswordIncorrect : data.code === "NEW_PASSWORD_TOO_SHORT" ? design.newPasswordTooShort : design.saveError);
      setMessage(copy.saved);
      if (locale !== initialLocale) window.location.assign(`/${locale}/account/my-learning/settings`);
    } catch (requestError) { setError(requestError instanceof Error && [design.currentPasswordIncorrect, design.newPasswordTooShort, design.saveError].includes(requestError.message) ? requestError.message : design.saveError); }
    finally { setBusy(false); }
  }

  const initial = (nickname.trim()[0] || "L").toUpperCase();
  return <PortalProvider locale={uiLocale}><ConfigProvider theme={{ token: { controlHeight: 38, borderRadius: 6, colorBorder: "#cbd5e1", fontSize: 14 } }}>
  <form className={`portal-form settings-form settings-design-form ${styles.root}`} onSubmit={submit}>
    {cropFile && <AvatarCropper file={cropFile} locale={uiLocale} onSave={uploadAvatar} onCancel={() => setCropFile(null)} />}
    <section className="settings-design-section settings-profile-section" aria-labelledby="settings-profile-heading">
      <h2 id="settings-profile-heading">{design.profile}</h2>
      <p className="settings-section-intro">{design.profileIntro}</p>
      <div className="settings-profile-grid">
        <div className="avatar-settings">
          <div className="avatar-preview">{avatar ? <img src={`/api/my-learning/avatar?v=${avatarVersion}`} alt={copy.avatar} /> : <span aria-hidden="true">{initial}</span>}</div>
          <div><div className="backoffice-row-actions"><label hidden className="portal-button portal-button-secondary avatar-upload">{copy.uploadAvatar}<input type="file" aria-label={copy.uploadAvatar} accept="image/jpeg,image/png" onChange={(event) => { selectAvatar(event.target.files?.[0]); event.target.value = ''; }} /></label>{avatar ? <PortalButton className="portal-button portal-button-secondary" onClick={() => void removeAvatar()}>{copy.removeAvatar}</PortalButton> : null}</div><p hidden className="settings-hint">{design.avatarRules}</p></div>
        </div>
        <div className="settings-profile-fields">
          <label>{copy.nickname}<Input value={nickname} autoComplete="name" onChange={event => { event.currentTarget.setCustomValidity(""); setNickname(event.target.value); }} onInvalid={event => event.currentTarget.setCustomValidity(nameCopy.nameInvalid)} onPaste={event => {
            const pasted = normalisePastedName(event.clipboardData.getData("text"));
            event.preventDefault();
            const input = event.currentTarget;
            input.setCustomValidity("");
            setNickname(input.value.slice(0, input.selectionStart ?? 0) + pasted + input.value.slice(input.selectionEnd ?? input.value.length));
          }} required /></label>
          <label>{copy.email}<Input value={initialEmail} readOnly disabled /></label>
        </div>
      </div>
      {avatarError ? <p className="portal-form-error" role="alert">{avatarError}</p> : null}
    </section>
    <section className="settings-design-section settings-details-section" aria-labelledby="settings-details-heading">
      <h2 id="settings-details-heading">{design.personalDetails}</h2>
      <p className="settings-section-intro">{design.detailsIntro}</p>
      <div className="settings-details-grid">
        <label htmlFor="settings-country">{copy.country}<Select id="settings-country" aria-label={copy.country} style={{ width: "100%", height: 38 }} value={country || undefined} onChange={setCountry} showSearch optionFilterProp="label" placeholder={copy.countryPlaceholder} options={countries.map(item => ({ value: item, label: item }))}/></label>
        <div className="settings-interest-field">
          <span id="settings-interests-label">{copy.areasOfInterest}</span>
          <Select aria-labelledby="settings-interests-label" style={{ width: "100%", minHeight: 38 }} mode="multiple" maxCount={5} maxTagCount="responsive"
            value={areasOfInterest} onChange={values => setAreasOfInterest(values.slice(0, 5))} placeholder={copy.areasHint}
            options={interestOptions.map((item, index) => ({ value: item, label: design.interestLabels[index] }))}/>
        </div>
        <label htmlFor="settings-age">{copy.ageRange}<Select id="settings-age" aria-label={copy.ageRange} style={{ width: "100%", height: 38 }} allowClear value={ageRange || undefined} onChange={value => setAgeRange(value || "")} placeholder={copy.agePlaceholder} options={ageRanges.map((item, index) => ({ value: item, label: design.ageLabels[index] }))}/></label>
        <label htmlFor="settings-education">{copy.education}<Select id="settings-education" aria-label={copy.education} style={{ width: "100%", height: 38 }} allowClear value={education || undefined} onChange={value => setEducation(value || "")} placeholder={copy.educationPlaceholder} options={educationLevels.map((item, index) => ({ value: item, label: design.educationLabels[index] }))}/></label>
      </div>
    </section>
    <section className="settings-design-section" aria-labelledby="settings-preferences-heading">
      <h2 id="settings-preferences-heading">{copy.language}</h2>
      <label htmlFor="settings-language"><span className="sr-only">{copy.language}</span><Select id="settings-language" aria-label={copy.language} style={{ width: "100%", height: 38 }} value={locale} onChange={setLocale} options={[{ value: "en-GB", label: copy.english }, { value: "zh-CN", label: copy.chinese }]}/></label>
    </section>

    {error ? <p className="portal-form-error" role="alert">{error}</p> : null}{message ? <p className="portal-success" role="status">{message}</p> : null}
    <div className="settings-save-row"><PortalButton className="portal-button portal-button-primary" type="primary" htmlType="submit" disabled={busy} loading={busy}>{copy.save}</PortalButton></div>
  </form></ConfigProvider></PortalProvider>;
}
