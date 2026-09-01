"use client";

import { FormEvent, useState } from "react";

export function SettingsForm({ initialNickname, initialLocale, hasAvatar, copy }: { initialNickname: string; initialLocale: "en-GB" | "zh-CN"; hasAvatar: boolean; copy: { avatar: string; uploadAvatar: string; removeAvatar: string; nickname: string; language: string; english: string; chinese: string; currentPassword: string; newPassword: string; confirmPassword: string; save: string; saved: string } }) {
  const [nickname, setNickname] = useState(initialNickname);
  const [locale, setLocale] = useState(initialLocale);
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
    const form = new FormData();
    form.set("file", file);
    const response = await fetch("/api/my-learning/avatar", { method: "POST", body: form });
    const data = await response.json() as { ok?: boolean; error?: string };
    if (!response.ok || !data.ok) { setAvatarError(data.error || "Image upload failed."); return; }
    setAvatar(true);
  }

  async function removeAvatar() {
    setAvatarError("");
    const response = await fetch("/api/my-learning/avatar", { method: "DELETE" });
    const data = await response.json() as { ok?: boolean; error?: string };
    if (!response.ok || !data.ok) { setAvatarError(data.error || "Image removal failed."); return; }
    setAvatar(false);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    setError("");
    if (newPassword !== confirmPassword) { setError("New passwords do not match."); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/my-learning/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nickname, locale, currentPassword, newPassword }) });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Settings update failed.");
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); setMessage(copy.saved);
      if (locale !== initialLocale) window.location.assign(`/${locale}/account/my-learning/settings`);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Settings update failed."); }
    finally { setBusy(false); }
  }

  return <form className="portal-form settings-form" onSubmit={submit}><div className="avatar-settings"><div className="avatar-preview">{avatar ? <img src="/api/my-learning/avatar" alt={copy.avatar} /> : <span aria-hidden="true">LG</span>}</div><div><strong>{copy.avatar}</strong><div className="backoffice-row-actions"><label className="portal-button portal-button-secondary avatar-upload">{copy.uploadAvatar}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void uploadAvatar(event.target.files?.[0])} /></label>{avatar ? <button className="portal-button portal-button-secondary" onClick={() => void removeAvatar()} type="button">{copy.removeAvatar}</button> : null}</div></div></div>{avatarError ? <p className="portal-form-error" role="alert">{avatarError}</p> : null}<label>{copy.nickname}<input value={nickname} onChange={(event) => setNickname(event.target.value)} maxLength={15} required /></label><label>{copy.language}<select value={locale} onChange={(event) => setLocale(event.target.value as "en-GB" | "zh-CN")}><option value="en-GB">{copy.english}</option><option value="zh-CN">{copy.chinese}</option></select></label><div className="settings-password"><h2>{copy.newPassword}</h2><label>{copy.currentPassword}<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" /></label><label>{copy.newPassword}<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={8} autoComplete="new-password" /></label><label>{copy.confirmPassword}<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={8} autoComplete="new-password" /></label></div>{error ? <p className="portal-form-error" role="alert">{error}</p> : null}{message ? <p className="portal-success" role="status">{message}</p> : null}<button className="portal-button portal-button-primary" disabled={busy}>{busy ? "..." : copy.save}</button></form>;
}
