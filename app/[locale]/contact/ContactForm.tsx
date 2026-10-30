"use client";

import { PortalProvider } from "@/components/portal/ui/PortalProvider";

import { Input } from "antd";
import { PortalButton } from "@/components/portal/ui/PortalButton";

import { Clock3, Mail, Send } from "lucide-react";
import { FormEvent, useRef, useState } from "react";
import type { getMessages } from "@/lib/i18n/messages";

type ContactCopy = ReturnType<typeof getMessages>["contactPage"];

export function ContactForm(props: Parameters<typeof ContactFormContent>[0]) {
  return <PortalProvider locale={props.locale}><ContactFormContent {...props}/></PortalProvider>;
}

function ContactFormContent({ copy, locale }: { copy: ContactCopy; locale: "en-GB" | "zh-CN" }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [sent, setSent] = useState(false);
  const [resetVersion, setResetVersion] = useState(0);
  const submitting = useRef(false);
  const pending = useRef<{ payload: string; id: string } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const element = event.currentTarget;
    const form = new FormData(element);
    const input = { firstName: String(form.get("firstName") || ""), lastName: String(form.get("lastName") || ""), email: String(form.get("email") || ""), phone: String(form.get("phone") || ""), subject: String(form.get("subject") || ""), message: String(form.get("message") || ""), consent: form.get("consent") === "on", locale };
    const payload = JSON.stringify(input);
    if (!pending.current || pending.current.payload !== payload) pending.current = { payload, id: crypto.randomUUID() };
    submitting.current = true; setBusy(true); setError(""); setSent(false);
    try {
      const response = await fetch("/api/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, clientEventId: pending.current.id }) });
      const result = await response.json() as { ok?: boolean; code?: string; data?: { id?: string } };
      if (!response.ok || !result.ok || !result.data?.id) {
        if (result.code === "CONTACT_CONFLICT") pending.current = null;
        throw new Error(result.code === "CONTACT_INVALID" ? copy.invalid : result.code === "CONTACT_CONFLICT" ? copy.conflict : copy.failed);
      }
      pending.current = null; element.reset(); setResetVersion(value => value + 1); setSent(true);
    } catch (failure) { setError(failure instanceof Error && [copy.invalid, copy.conflict, copy.failed].includes(failure.message) ? failure.message : copy.failed); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <>
    <section className="contact-hero"><h1>{copy.title}</h1><p>{copy.description}</p></section>
    <section className="contact-information" aria-labelledby="contact-information-title"><h2 id="contact-information-title">{copy.information}</h2><div className="contact-information-grid"><article><span className="contact-info-icon"><Mail size={22} aria-hidden="true" /></span><div><h3>{copy.email}</h3>{copy.emailAddresses.map((address) => <a key={address} href={`mailto:${address}`}>{address}</a>)}</div></article><article><span className="contact-info-icon"><Clock3 size={22} aria-hidden="true" /></span><div><h3>{copy.hours}</h3><p>{copy.hoursWeekday}</p><p>{copy.hoursWeekend}</p></div></article></div></section>
    <section className="contact-form-section"><form className="contact-form" onSubmit={submit} onChange={() => setSent(false)} onInvalid={event => (event.target as HTMLInputElement).setCustomValidity(copy.invalid)} onInput={event => (event.target as HTMLInputElement).setCustomValidity("")}><fieldset disabled={busy} style={{display:"contents"}}><h2>{copy.formTitle}</h2><div className="contact-name-fields"><label>{copy.firstName} *<Input key={resetVersion} required maxLength={50} name="firstName" placeholder={copy.placeholders.firstName} /></label><label>{copy.lastName} *<Input key={resetVersion} required maxLength={50} name="lastName" placeholder={copy.placeholders.lastName} /></label></div><label>{copy.emailAddress} *<Input key={resetVersion} required maxLength={254} type="email" name="email" placeholder={copy.placeholders.email} /></label><label>{copy.phone}<Input key={resetVersion} name="phone" maxLength={40} type="tel" placeholder={copy.placeholders.phone} /></label><label>{copy.subject} *<Input key={resetVersion} required maxLength={200} name="subject" /></label><label>{copy.message} *<Input.TextArea key={resetVersion} required maxLength={5000} name="message" placeholder={copy.placeholders.message} /></label><label className="contact-consent"><input required name="consent" type="checkbox" /> <span>{copy.consent}</span></label>{error ? <p role="alert" className="portal-form-error">{error}</p> : null}{sent ? <p role="status" className="portal-success">{copy.success}</p> : null}<PortalButton className="contact-submit" type="primary" disabled={busy} loading={busy} htmlType="submit"><Send size={15} aria-hidden="true" />{busy ? copy.submitting : copy.submit}</PortalButton></fieldset></form></section>
  </>;
}
