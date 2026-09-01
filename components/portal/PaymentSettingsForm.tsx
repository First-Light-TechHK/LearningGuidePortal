"use client";

import { FormEvent, useState } from "react";

type Settings = { name: string; publishableKey: string; returnUrl: string; paymentNotifications: boolean; secretConfigured: boolean };

export function PaymentSettingsForm({ initialSettings, copy }: { initialSettings: Settings; copy: { name: string; publishableKey: string; returnUrl: string; notifications: string; secret: string; configured: string; notConfigured: string; save: string; saved: string; error: string } }) {
  const [settings, setSettings] = useState(initialSettings);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/backoffice/payment", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: settings.name, publishableKey: settings.publishableKey, returnUrl: settings.returnUrl, paymentNotifications: settings.paymentNotifications }) });
      const data = await response.json() as { ok?: boolean; settings?: Settings; error?: string };
      if (!response.ok || !data.ok || !data.settings) throw new Error(data.error || copy.error);
      setSettings(data.settings);
      setMessage(copy.saved);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : copy.error);
    } finally {
      setBusy(false);
    }
  }

  return <form className="portal-form settings-form" onSubmit={submit}>
    <label>{copy.name}<input value={settings.name} onChange={(event) => setSettings((current) => ({ ...current, name: event.target.value }))} required /></label>
    <label>{copy.publishableKey}<input value={settings.publishableKey} onChange={(event) => setSettings((current) => ({ ...current, publishableKey: event.target.value }))} placeholder="pk_test_..." /></label>
    <label>{copy.returnUrl}<input value={settings.returnUrl} onChange={(event) => setSettings((current) => ({ ...current, returnUrl: event.target.value }))} placeholder="https://learning-guide.example" /></label>
    <label className="backoffice-checkbox"><input type="checkbox" checked={settings.paymentNotifications} onChange={(event) => setSettings((current) => ({ ...current, paymentNotifications: event.target.checked }))} />{copy.notifications}</label>
    <p className={settings.secretConfigured ? "portal-success" : "portal-form-error"}>{copy.secret}: {settings.secretConfigured ? copy.configured : copy.notConfigured}</p>
    {error ? <p className="portal-form-error" role="alert">{error}</p> : null}
    {message ? <p className="portal-success" role="status">{message}</p> : null}
    <button className="portal-button portal-button-primary" disabled={busy} type="submit">{busy ? "..." : copy.save}</button>
  </form>;
}
