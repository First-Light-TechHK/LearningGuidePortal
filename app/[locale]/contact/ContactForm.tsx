"use client";

import { Clock3, Mail, Send } from "lucide-react";
import { FormEvent } from "react";

type ContactCopy = { title: string; description: string; information: string; email: string; emailAddresses: string[]; hours: string; hoursWeekday: string; hoursWeekend: string; formTitle: string; firstName: string; lastName: string; emailAddress: string; phone: string; subject: string; message: string; consent: string; submit: string; placeholders: { firstName: string; lastName: string; email: string; phone: string; message: string }; };

export function ContactForm({ copy }: { copy: ContactCopy }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const subject = String(form.get("subject") || "Learning Guide support request");
    const body = [`${copy.firstName}: ${form.get("firstName")}`, `${copy.lastName}: ${form.get("lastName")}`, `${copy.emailAddress}: ${form.get("email")}`, `${copy.phone}: ${form.get("phone") || "-"}`, "", String(form.get("message") || "")].join("\n");
    window.location.assign(`mailto:${copy.emailAddresses[0]}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
  }
  return <>
    <section className="contact-hero"><h1>{copy.title}</h1><p>{copy.description}</p></section>
    <section className="contact-information" aria-labelledby="contact-information-title"><h2 id="contact-information-title">{copy.information}</h2><div className="contact-information-grid"><article><span className="contact-info-icon"><Mail size={22} aria-hidden="true" /></span><div><h3>{copy.email}</h3>{copy.emailAddresses.map((address) => <a key={address} href={`mailto:${address}`}>{address}</a>)}</div></article><article><span className="contact-info-icon"><Clock3 size={22} aria-hidden="true" /></span><div><h3>{copy.hours}</h3><p>{copy.hoursWeekday}</p><p>{copy.hoursWeekend}</p></div></article></div></section>
    <section className="contact-form-section"><form className="contact-form" onSubmit={submit}><h2>{copy.formTitle}</h2><div className="contact-name-fields"><label>{copy.firstName} *<input required name="firstName" placeholder={copy.placeholders.firstName} /></label><label>{copy.lastName} *<input required name="lastName" placeholder={copy.placeholders.lastName} /></label></div><label>{copy.emailAddress} *<input required type="email" name="email" placeholder={copy.placeholders.email} /></label><label>{copy.phone}<input name="phone" type="tel" placeholder={copy.placeholders.phone} /></label><label>{copy.subject} *<input required name="subject" /></label><label>{copy.message} *<textarea required name="message" placeholder={copy.placeholders.message} /></label><label className="contact-consent"><input required type="checkbox" /> <span>{copy.consent}</span></label><button className="contact-submit" type="submit"><Send size={15} aria-hidden="true" />{copy.submit}</button></form></section>
  </>;
}
