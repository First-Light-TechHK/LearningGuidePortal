"use client";
// Learner Contact Support (Figma 1216:6) with the AI Support Assistant modal
// (Figma 1333:249). Submit validates in the page, asks for a suggestion (never
// blocking: no answer, an error or a slow answer submits directly), and then
// creates the ticket with one Idempotency-Key per logical submit.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, Check, ChevronDown, ChevronRight, ChevronUp, CircleHelp, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { CommonQuestion, HelpdeskSuggestion, SuggestionOutcome, TicketCategory, TicketDetail } from "@/contracts/helpdesk";
import { answerBlocks, fileSignature, fillTemplate, firstName, initials, problemMessageKey, SubmissionKeys, type HelpdeskUiConfig } from "@/modules/helpdesk/learnerUi";
import { createTicket, newIdempotencyKey, reportSuggestionOutcome, requestSuggestion } from "./helpdeskApi";
import { AttachmentZone, FileSummaryChip, LinkifiedText, useAttachments, type HelpdeskCopy } from "./HelpdeskParts";
import "./helpdesk.css";

type Locale = "en-GB" | "zh-CN";
type Field = "category" | "subject" | "message" | "email";
type Phase = "form" | "suggestion" | "thanks" | "success";

const EMAIL = /^[^\s@"<>()[\],;:\\]+@[^\s@"<>()[\],;:\\]+\.[^\s@"<>()[\],;:\\]{2,}$/;
const THANKS_REDIRECT_MS = 2_000;

export function ContactSupport({ locale, copy, config, account, questions }: { locale: Locale; copy: HelpdeskCopy; config: HelpdeskUiConfig; account: { name: string; email: string }; questions: CommonQuestion[] }) {
  const router = useRouter();
  const ids = useId();
  const [category, setCategory] = useState<TicketCategory | "">("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState(account.email);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState<"" | "checking" | "submitting">("");
  const [phase, setPhase] = useState<Phase>("form");
  const [suggestion, setSuggestion] = useState<HelpdeskSuggestion | null>(null);
  const [askedAt, setAskedAt] = useState<Date | null>(null);
  const [created, setCreated] = useState<TicketDetail | null>(null);
  const attachments = useAttachments(config, copy);
  const keys = useRef(new SubmissionKeys(newIdempotencyKey));
  const inFlight = useRef(false);
  const subjectInput = useRef<HTMLInputElement>(null);
  const accountHome = `/${locale}/account/my-learning`;
  const enquiriesHref = `/${locale}/account/my-learning/support/enquiries`;

  useEffect(() => {
    if (phase !== "thanks") return;
    const timer = setTimeout(() => router.push(accountHome), THANKS_REDIRECT_MS);
    return () => clearTimeout(timer);
  }, [phase, router, accountHome]);

  function validate() {
    const found: Partial<Record<Field, string>> = {};
    if (!category) found.category = copy.validation.category;
    if (!subject.trim() || subject.trim().length > config.limits.subjectMax) found.subject = copy.validation.subject;
    if (!message.trim() || message.trim().length > config.limits.bodyMax) found.message = copy.validation.message;
    if (!EMAIL.test(email.trim()) || email.trim().length > config.limits.emailMax) found.email = copy.validation.email;
    setErrors(found);
    const first = (["category", "subject", "message", "email"] as const).find((field) => found[field]);
    if (first) document.getElementById(`${ids}-${first}`)?.focus();
    return !first;
  }

  async function submitTicket(suggestionId: string | null) {
    setBusy("submitting");
    const fields: Record<string, string> = { category, subject: subject.trim(), body: message.trim(), locale, contactEmail: email.trim() };
    if (suggestionId) fields.suggestionId = suggestionId;
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) form.append(name, value);
    for (const file of attachments.files) form.append("files[]", file, file.name);
    const key = keys.current.keyFor(JSON.stringify(fields) + fileSignature(attachments.files));
    const result = await createTicket(form, key);
    setBusy("");
    if (result.ok) {
      keys.current.done();
      setCreated(result.data);
      setPhase("success");
      window.scrollTo({ top: 0 });
      return;
    }
    // A 4xx is final for this payload; a network error or 5xx keeps the key so a retry replays.
    if (result.status >= 400 && result.status < 500) keys.current.done();
    setPhase("form");
    setFormError(copy.errors[problemMessageKey(result.status, result.code)]);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    setFormError("");
    attachments.setError("");
    if (!validate()) return;
    inFlight.current = true;
    try {
      setBusy("checking");
      const found = await requestSuggestion({ category, subject: subject.trim(), message: message.trim(), locale });
      if (found) {
        setBusy("");
        setSuggestion(found);
        setAskedAt(new Date());
        setPhase("suggestion");
        return;
      }
      await submitTicket(null);
    } finally {
      inFlight.current = false;
      setBusy((value) => (value === "checking" ? "" : value));
    }
  }

  function closeSuggestion(outcome: SuggestionOutcome) {
    if (suggestion) reportSuggestionOutcome(suggestion.id, outcome);
    if (outcome === "solved") { setPhase("thanks"); return; }
    if (outcome === "edited") { setPhase("form"); setTimeout(() => subjectInput.current?.focus(), 0); return; }
    if (inFlight.current || !suggestion) return;
    inFlight.current = true;
    void submitTicket(suggestion.id).finally(() => { inFlight.current = false; });
  }

  function cancel() {
    if (window.history.length > 1) router.back();
    else router.push(accountHome);
  }

  const fieldProps = (field: Field) => ({ id: `${ids}-${field}`, "aria-invalid": errors[field] ? true : undefined, "aria-describedby": errors[field] ? `${ids}-${field}-error` : undefined });
  const fieldError = (field: Field) => errors[field] ? <p id={`${ids}-${field}-error`} className="helpdesk-field-error">{errors[field]}</p> : null;
  const label = (field: Field, text: string) => <label className="helpdesk-label" id={`${ids}-${field}-label`} htmlFor={`${ids}-${field}`}>{text}<span aria-hidden="true">*</span></label>;
  const disabled = busy !== "";

  return <div className="helpdesk-card">
    <div className={`helpdesk-card-content${questions.length ? "" : " helpdesk-card-single"}`}>
      {phase === "success" && created ? <SuccessPanel copy={copy} ticket={created} ticketHref={`/${locale}/account/my-learning/support/${created.id}`} enquiriesHref={enquiriesHref} /> :
        <form className="helpdesk-form" noValidate onSubmit={onSubmit} onPaste={attachments.onPaste}>
          <div className="helpdesk-form-title"><h1>{copy.pageTitle}</h1><Link prefetch={false} className="helpdesk-text-link" href={enquiriesHref}>{copy.myEnquiries}</Link></div>
          <div className="helpdesk-field">
            <span className="helpdesk-label" id={`${ids}-category-label`}>{copy.enquiryType}<span aria-hidden="true">*</span></span>
            <TopicSelect copy={copy} options={config.categories as TicketCategory[]} value={category} disabled={disabled} buttonProps={fieldProps("category")} labelledBy={`${ids}-category-label`}
              onChange={(value) => { setCategory(value); setErrors((current) => ({ ...current, category: undefined })); }} />
            {fieldError("category")}
          </div>
          <div className="helpdesk-field">{label("subject", copy.subject)}<input ref={subjectInput} {...fieldProps("subject")} className="helpdesk-input" maxLength={config.limits.subjectMax} placeholder={copy.subjectPlaceholder} value={subject} disabled={disabled} onChange={(event) => setSubject(event.target.value)} />{fieldError("subject")}</div>
          <div className="helpdesk-field">{label("message", copy.message)}<textarea {...fieldProps("message")} className="helpdesk-input helpdesk-textarea" maxLength={config.limits.bodyMax} placeholder={copy.messagePlaceholder} value={message} disabled={disabled} onChange={(event) => setMessage(event.target.value)} />{fieldError("message")}</div>
          <AttachmentZone copy={copy} config={config} attachments={attachments} disabled={disabled} inputId={`${ids}-files`} />
          <div className="helpdesk-field">{label("email", copy.email)}<input {...fieldProps("email")} className="helpdesk-input" type="email" autoComplete="email" maxLength={config.limits.emailMax} value={email} disabled={disabled} onChange={(event) => setEmail(event.target.value)} />{fieldError("email")}<p className="helpdesk-email-note">{copy.emailNote}</p></div>
          {formError ? <p role="alert" className="helpdesk-inline-error">{formError}</p> : null}
          <div className="helpdesk-form-actions">
            <button type="button" className="helpdesk-cancel-button" onClick={cancel} disabled={busy === "submitting"}>{copy.cancel}</button>
            <button type="submit" className="helpdesk-submit-button" disabled={disabled}>{busy === "checking" ? copy.assistant.checking : busy === "submitting" ? copy.submitting : copy.submit}</button>
          </div>
        </form>}
      {questions.length ? <><div className="helpdesk-divider" aria-hidden="true" /><CommonQuestions copy={copy} questions={questions} /></> : null}
    </div>
    {(phase === "suggestion" || phase === "thanks") && suggestion ? <AssistantModal copy={copy} locale={locale} suggestion={suggestion} thanks={phase === "thanks"} busy={busy === "submitting"} accountHome={accountHome}
      enquiry={{ name: account.name, email: email.trim(), subject: subject.trim(), category: category as TicketCategory, message: message.trim(), askedAt: askedAt ?? new Date(), files: attachments.files }}
      onOutcome={closeSuggestion} /> : null}
  </div>;
}

function TopicSelect({ copy, options, value, onChange, disabled, buttonProps, labelledBy }: { copy: HelpdeskCopy; options: TicketCategory[]; value: TicketCategory | ""; onChange: (value: TicketCategory) => void; disabled: boolean; buttonProps: Record<string, unknown> & { id: string }; labelledBy: string }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const listId = `${buttonProps.id}-options`;
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  function choose(index: number) {
    onChange(options[index]);
    setOpen(false);
    document.getElementById(buttonProps.id)?.focus();
  }
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) { setOpen(true); setActive(Math.max(0, options.indexOf(value as TicketCategory))); return; }
      setActive((index) => (index + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
    } else if ((event.key === "Enter" || event.key === " ") && open) { event.preventDefault(); choose(active); }
    else if (event.key === "Escape" && open) { event.preventDefault(); setOpen(false); }
  }
  return <div className={`helpdesk-select${open ? " is-open" : ""}`} ref={root}>
    <button type="button" role="combobox" {...buttonProps} aria-labelledby={labelledBy} aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} aria-activedescendant={open ? `${listId}-${active}` : undefined} disabled={disabled}
      className={`helpdesk-select-trigger${value ? " has-value" : ""}`} onClick={() => { setActive(Math.max(0, options.indexOf(value as TicketCategory))); setOpen((current) => !current); }} onKeyDown={onKeyDown}>
      <span>{value ? copy.categories[value] : copy.selectTopic}</span>{open ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
    </button>
    {open ? <ul className="helpdesk-select-options" role="listbox" id={listId} aria-labelledby={labelledBy}>
      {options.map((option, index) => <li key={option} id={`${listId}-${index}`} role="option" aria-selected={value === option} className={index === active ? "is-active" : undefined} onMouseEnter={() => setActive(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(index)}>{copy.categories[option]}</li>)}
    </ul> : null}
  </div>;
}

function CommonQuestions({ copy, questions }: { copy: HelpdeskCopy; questions: CommonQuestion[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const ids = useId();
  return <section className="helpdesk-questions" aria-labelledby={`${ids}-title`}>
    <h2 id={`${ids}-title`}><CircleHelp size={20} aria-hidden="true" />{copy.commonQuestions}</h2>
    <ul>{questions.map((question) => {
      const expanded = open === question.id;
      return <li key={question.id} className={expanded ? "is-open" : undefined}>
        <button type="button" aria-expanded={expanded} aria-controls={`${ids}-${question.id}`} onClick={() => setOpen(expanded ? null : question.id)}><span>{question.question}</span><ChevronRight size={16} aria-hidden="true" /></button>
        <div id={`${ids}-${question.id}`} className="helpdesk-question-answer" hidden={!expanded}>{question.answer.split(/\n/).filter((line) => line.trim()).map((line, index) => <p key={index}><LinkifiedText text={line} /></p>)}</div>
      </li>;
    })}</ul>
  </section>;
}

type Enquiry = { name: string; email: string; subject: string; category: TicketCategory; message: string; askedAt: Date; files: File[] };

function AssistantModal({ copy, locale, suggestion, enquiry, thanks, busy, accountHome, onOutcome }: { copy: HelpdeskCopy; locale: Locale; suggestion: HelpdeskSuggestion; enquiry: Enquiry; thanks: boolean; busy: boolean; accountHome: string; onOutcome: (outcome: SuggestionOutcome) => void }) {
  const ids = useId();
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialog.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);
  const name = firstName(enquiry.name);
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false }).format(enquiry.askedAt);
  const paragraphs = enquiry.message.split(/\n/);
  return <div className="helpdesk-modal-backdrop">
    <div className="helpdesk-modal" role="dialog" aria-modal="true" aria-labelledby={`${ids}-title`} tabIndex={-1} ref={dialog}
      onKeyDown={(event) => { if (event.key === "Escape" && !thanks && !busy) onOutcome("edited"); }}>
      <header className="helpdesk-modal-header">
        <div className="helpdesk-modal-heading"><span className="helpdesk-modal-icon"><Bot size={20} aria-hidden="true" /></span><div><h2 id={`${ids}-title`}>{copy.assistant.title}</h2><p>{copy.assistant.subtitle}</p></div></div>
        {thanks ? null : <button type="button" className="helpdesk-modal-close" aria-label={copy.assistant.close} disabled={busy} onClick={() => onOutcome("edited")}><X size={14} aria-hidden="true" /></button>}
      </header>
      {thanks ? <div className="helpdesk-modal-thanks" role="status"><span className="helpdesk-success-icon"><Check size={22} aria-hidden="true" /></span><h3>{copy.assistant.thanksTitle}</h3><p>{copy.assistant.thanksBody}</p><Link prefetch={false} className="helpdesk-submit-button" href={accountHome}>{copy.assistant.backToAccount}</Link></div> : <>
        <div className="helpdesk-modal-body">
          <section className="helpdesk-modal-query">
            <span className="helpdesk-avatar" aria-hidden="true">{initials(enquiry.name, enquiry.email)}</span>
            <div className="helpdesk-modal-query-content">
              <div className="helpdesk-modal-query-title"><h3>{enquiry.subject}</h3><span className="helpdesk-type-tag">{copy.categories[enquiry.category]}</span></div>
              <p className="helpdesk-modal-meta">{enquiry.email} · {time}</p>
              <div className="helpdesk-modal-text">{paragraphs.map((line, index) => <p key={index}>{line || "​"}</p>)}</div>
              {enquiry.files.length ? <div className="helpdesk-modal-files">{enquiry.files.map((file, index) => <FileSummaryChip key={index} name={file.name} size={file.size} image={file.type.startsWith("image/")} />)}</div> : null}
            </div>
          </section>
          <section className="helpdesk-modal-answer">
            <span className="helpdesk-bot-avatar" aria-hidden="true"><Bot size={18} /></span>
            <div className="helpdesk-modal-answer-content">
              <p className="helpdesk-answer-greeting">{name ? fillTemplate(copy.assistant.greeting, { name }) : copy.assistant.greetingNoName}</p>
              {answerBlocks(suggestion.answer).map((block, index) => <div key={index} className="helpdesk-answer-block">
                {block.heading ? <p className="helpdesk-answer-heading">{block.heading}</p> : null}
                {block.lines.map((line, lineIndex) => <p key={lineIndex}><LinkifiedText text={line} /></p>)}
              </div>)}
            </div>
          </section>
        </div>
        <footer className="helpdesk-modal-footer">
          <div className="helpdesk-modal-helpful">
            <p>{copy.assistant.helpful}</p>
            <div>
              <button type="button" className="helpdesk-feedback-button helpdesk-feedback-yes" disabled={busy} onClick={() => onOutcome("solved")}><ThumbsUp size={14} aria-hidden="true" />{copy.assistant.yes}</button>
              <button type="button" className="helpdesk-feedback-button helpdesk-feedback-no" disabled={busy} onClick={() => onOutcome("declined")}><ThumbsDown size={14} aria-hidden="true" />{busy ? copy.submitting : copy.assistant.no}</button>
              <button type="button" className="helpdesk-feedback-button" disabled={busy} onClick={() => onOutcome("edited")}>{copy.assistant.edit}</button>
            </div>
          </div>
          <div className="helpdesk-modal-footer-spacer" />
        </footer>
      </>}
    </div>
  </div>;
}

function SuccessPanel({ copy, ticket, ticketHref, enquiriesHref }: { copy: HelpdeskCopy; ticket: TicketDetail; ticketHref: string; enquiriesHref: string }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const [before, after] = copy.success.reference.split("{number}");
  return <section className="helpdesk-success" aria-live="polite">
    <span className="helpdesk-success-icon"><Check size={22} aria-hidden="true" /></span>
    <h1 ref={heading} tabIndex={-1}>{copy.success.title}</h1>
    <p>{before}<strong className="helpdesk-success-number">{ticket.number}</strong>{after}</p>
    <p>{fillTemplate(copy.success.reply, { email: ticket.contactEmail })}</p>
    <div className="helpdesk-success-actions"><Link prefetch={false} className="helpdesk-submit-button" href={ticketHref}>{copy.success.view}</Link><Link prefetch={false} className="helpdesk-secondary-button" href={enquiriesHref}>{copy.success.list}</Link></div>
  </section>;
}

