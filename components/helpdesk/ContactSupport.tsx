"use client";
// Learner Contact Support (Figma 1216:6): the enquiry form, the AI Support
// Assistant chat panel on the right (AssistantChat), and the submit-time AI
// Support Assistant modal (Figma 1333:249). Submit validates in the page, asks for a suggestion (never
// blocking: no answer, an error or a slow answer submits directly), and then
// creates the ticket with one Idempotency-Key per logical submit. Cancel or
// leaving the page during the check never creates a ticket, and a submit
// whose response was lost is resent as it was (same key, same declined
// suggestion, same chat assistIds) so the server replays it. The ticket links
// the chat answers the learner saw (assistIds) and the declined suggestion.
// v3 (helpdesk-v3-alternatives-rating, 2026-10-29): the learner always gets
// a solution before a person takes over. With no suggestion but Admin's
// alternatives, the modal offers "You might be asking" questions (asked as
// chips; the answer shows with the helpful row) and an always visible "None
// of these, submit to support" (GB/T 47746-2026: the human entry is never
// hidden). "Yes, this solved my issue" is followed by a small rating card
// (5 stars or Skip) before going back to the account. There is no Figma
// frame for these states: they reuse the chip, button, answer box and star
// styles inside 1333:249 and are 待视觉验收 (pending visual sign-off).
// v4 Part A (helpdesk-v4-order-and-chat-end, 2026-10-29): opened from a
// payment record (?orderId=), the page passes the learner's own order (the
// server page checked it is theirs). Enquiry Type starts on Payments &
// Subscriptions (still changeable), a read-only "Order: <number>" line sits
// above Subject with a Remove control, and the number goes with the ticket
// as orderId (the server checks ownership again; a 400 field orderId says
// so and the learner can remove it and submit). The order never goes to the
// AI suggestion check. No Figma frame: the line reuses the field, label and
// text-link styles and is 待视觉验收.
// v4 Part B: the chat's handover card ("Let's get you to a person", and
// "Contact a person" on "Still need help?") opens this form: focus moves to
// Subject, and the enquiry carries the chat's assistIds as before. After an
// enquiry was sent, it opens a fresh form for the next one.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Star, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type FocusEvent, type FormEvent, type KeyboardEvent } from "react";
import type { HelpdeskAlternative, HelpdeskSuggestion, SuggestionOutcome, TicketCategory, TicketDetail } from "@/contracts/helpdesk";
import { fillTemplate, firstName, initials, inputMaxLength, isValidEmail, isValidText, linkedAssistIds, nextFocusIndex, problemMessageKey, readSeenAnswers, rememberSeenAnswer, RetryableSubmit, seenStorageKey, submissionSignature, SubmissionKeys, type HelpdeskUiConfig, type SeenAnswer } from "@/modules/helpdesk/learnerUi";
import { alternativesIn, askAssistant, createTicket, newIdempotencyKey, rateAnswer, reportSuggestionOutcome, requestSuggestion, sendAssistantFeedback } from "./helpdeskApi";
import { AssistantChat, type ChatChip } from "./AssistantChat";
import { AttachmentZone, FileSummaryChip, useAttachments, type HelpdeskCopy } from "./HelpdeskParts";
import { Markdown } from "./Markdown";
import "./helpdesk.css";

type Locale = "en-GB" | "zh-CN";
type Field = "category" | "subject" | "message" | "email";
/** suggestion: 1333:249 with an answer; alternatives (v3): "You might be asking"; rating (v3): the card after Yes; thanks: back to the account. */
type Phase = "form" | "suggestion" | "alternatives" | "rating" | "thanks" | "success";
/** The alternative the learner picked in the modal: waiting for its answer, or the answer (verbatim FAQ text). */
export type Picked = { status: "pending"; faqId: string } | { status: "answer"; faqId: string; id: string; reply: HelpdeskSuggestion };

const THANKS_REDIRECT_MS = 2_000;

export function ContactSupport({ locale, copy, config, account, chips, order = null, orderUnavailable = false }: { locale: Locale; copy: HelpdeskCopy; config: HelpdeskUiConfig; account: { id: string; name: string; email: string }; chips: ChatChip[]; order?: { id: string } | null; /** v4: opened for an order that could not be attached (not the learner's, unknown, or the order store failed). */ orderUnavailable?: boolean }) {
  const router = useRouter();
  const ids = useId();
  // Figma 1.2 Help Page: defaults to Technical Support; v4: Payments & Subscriptions when opened from a payment record.
  const [category, setCategory] = useState<TicketCategory | "">(order || orderUnavailable ? "payments_subscriptions" : "technical_support");
  /** v4 Part A: the learner's order this enquiry is about, until they remove it. */
  const [linkedOrder, setLinkedOrder] = useState<{ id: string } | null>(order);
  const [orderNotice, setOrderNotice] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState(account.email);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState<"" | "checking" | "submitting">("");
  const [phase, setPhase] = useState<Phase>("form");
  const [suggestion, setSuggestion] = useState<HelpdeskSuggestion | null>(null);
  const [alternatives, setAlternatives] = useState<HelpdeskAlternative[]>([]);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [pickError, setPickError] = useState(false);
  /** The answer the rating card rates (the suggestion or the picked alternative's answer). */
  const [ratingFor, setRatingFor] = useState<string | null>(null);
  const [rating, setRating] = useState<"idle" | "saving" | "error" | "rated">("idle");
  const [askedAt, setAskedAt] = useState<Date | null>(null);
  const [created, setCreated] = useState<TicketDetail | null>(null);
  const attachments = useAttachments(config, copy, busy !== "");
  const keys = useRef(new SubmissionKeys(newIdempotencyKey));
  const retry = useRef(new RetryableSubmit());
  const inFlight = useRef(false);
  /** The chat answers to link to the enquiry (newest 10), kept up to date by AssistantChat. */
  const assistIds = useRef<string[]>([]);
  /** v4 Part B: the learner's last input anywhere on this page (epoch ms), so the chat never ends idle while they fill in the form. */
  const pageInput = useRef(0);
  const markInput = () => { pageInput.current = Date.now(); };
  /** v3: the modal answers the learner saw, when sessionStorage is blocked (otherwise they live there, per account: seenStorageKey). */
  const seenFallback = useRef<SeenAnswer[]>([]);
  /** Bumped by Skip and by each rating save, so a save that lands after Skip changes nothing. */
  const ratingRun = useRef(0);
  /** Bumped whenever the modal opens, closes or hands over, so an alternative's answer arriving late is dropped. */
  const modalRun = useRef(0);
  /** Set by Cancel and on unmount: a suggestion check still running must not go on to create a ticket. */
  const abandoned = useRef(false);
  const suggestionCheck = useRef<AbortController | null>(null);
  const subjectInput = useRef<HTMLInputElement>(null);
  const submitButton = useRef<HTMLButtonElement>(null);
  const accountHome = `/${locale}/account/my-learning`;
  const enquiriesHref = `/${locale}/account/my-learning/support/enquiries`;

  useEffect(() => {
    abandoned.current = false;
    return () => { abandoned.current = true; suggestionCheck.current?.abort(); };
  }, []);

  useEffect(() => {
    if (phase !== "thanks") return;
    const timer = setTimeout(() => router.push(accountHome), THANKS_REDIRECT_MS);
    return () => clearTimeout(timer);
  }, [phase, router, accountHome]);

  function validate() {
    const found: Partial<Record<Field, string>> = {};
    if (!category) found.category = copy.validation.category;
    if (!isValidText(subject, config.limits.subjectMax)) found.subject = copy.validation.subject;
    if (!isValidText(message, config.limits.bodyMax)) found.message = copy.validation.message;
    if (!isValidEmail(email, config.limits.emailMax)) found.email = copy.validation.email;
    setErrors(found);
    const first = (["category", "subject", "message", "email"] as const).find((field) => found[field]);
    if (first) document.getElementById(`${ids}-${first}`)?.focus();
    return !first;
  }

  /**
   * v3: the submit modal's answers the learner was shown (the suggestion, a
   * picked alternative's answer), kept for this tab so the next enquiry links
   * them too, after Edit, Close or a "Yes, solved" that went back to the account.
   */
  function seenAnswers(): SeenAnswer[] {
    const at = new Date();
    try { return readSeenAnswers(window.sessionStorage.getItem(seenStorageKey(account.id)), at); } catch { return readSeenAnswers(JSON.stringify(seenFallback.current), at); }
  }
  function storeSeen(list: SeenAnswer[]) {
    seenFallback.current = list;
    try { window.sessionStorage.setItem(seenStorageKey(account.id), JSON.stringify(list)); } catch { /* storage blocked: kept in memory for this page */ }
  }
  const rememberSeen = (id: string) => storeSeen(rememberSeenAnswer(seenAnswers(), id, new Date()));

  /** What an enquiry links: the chat answers and the modal answers the learner saw (newest 10); a declined suggestion goes as suggestionId instead. */
  function linkedIds(declined: string | null): string[] {
    const keep = (id: string) => id !== declined;
    return linkedAssistIds(assistIds.current.filter(keep), seenAnswers().map((item) => item.id).filter(keep));
  }

  function formFields(): Record<string, string> {
    return { category, subject: subject.trim(), body: message.trim(), locale, contactEmail: email.trim(), ...(linkedOrder ? { orderId: linkedOrder.id } : {}) };
  }

  /** v4: "Remove" drops the order from this enquiry; focus goes on to Subject and the change is announced. */
  function removeOrder() {
    setLinkedOrder(null);
    setOrderNotice(copy.order.removed);
    setFormError("");
    subjectInput.current?.focus();
  }

  async function submitTicket(suggestionId: string | null, linked: string[] = linkedIds(suggestionId)) {
    setBusy("submitting");
    const fields = formFields();
    const signature = submissionSignature(fields, attachments.files);
    if (suggestionId) fields.suggestionId = suggestionId;
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) form.append(name, value);
    for (const id of linked) form.append("assistIds", id);
    for (const file of attachments.files) form.append("files[]", file, file.name);
    const key = keys.current.keyFor(signature);
    const result = await createTicket(form, key);
    if (abandoned.current) return;
    setBusy("");
    if (result.ok) {
      keys.current.done();
      retry.current.clear();
      storeSeen([]); // linked to this enquiry now
      setCreated(result.data);
      setPhase("success");
      window.scrollTo({ top: 0 });
      return;
    }
    // A 4xx is final for this payload; a network error or 5xx keeps the key (and the declined suggestion) so a retry replays.
    if (result.status >= 400 && result.status < 500) keys.current.done();
    retry.current.failed(signature, suggestionId, result.status, linked);
    setPhase("form");
    // v4: the server would not link this order (not the learner's, or gone): say so; Remove is right there.
    setFormError(result.code === "validation_failed" && result.field === "orderId" && linkedOrder ? copy.order.invalid : copy.errors[problemMessageKey(result.status, result.code)]);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    setFormError("");
    attachments.setError("");
    if (!validate()) return;
    inFlight.current = true;
    // A new Submit is never abandoned (Cancel may have left a page the browser later restored from the back-forward cache).
    abandoned.current = false;
    try {
      // Same form as a submit that may have reached the server: resend it as it was, without a new suggestion check.
      const again = retry.current.retryFor(submissionSignature(formFields(), attachments.files));
      if (again) { await submitTicket(again.suggestionId, again.assistIds); return; }
      setBusy("checking");
      const check = new AbortController();
      suggestionCheck.current = check;
      // The AI check never gets the order (v4): only what the learner typed.
      const found = await requestSuggestion({ category, subject: subject.trim(), message: message.trim(), locale }, { signal: check.signal });
      suggestionCheck.current = null;
      if (abandoned.current) return;
      modalRun.current += 1;
      setPicked(null);
      setPickError(false);
      setRating("idle");
      if (found.suggestion) {
        rememberSeen(found.suggestion.id);
        setBusy("");
        setSuggestion(found.suggestion);
        setAlternatives([]);
        setAskedAt(new Date());
        setPhase("suggestion");
        return;
      }
      // v3 §1: no answer, but questions the learner may mean: offer them before a person takes over.
      const offered = alternativesIn(found.alternatives);
      if (offered.length) {
        setBusy("");
        setSuggestion(null);
        setAlternatives(offered);
        setAskedAt(new Date());
        setPhase("alternatives");
        return;
      }
      await submitTicket(null);
    } finally {
      inFlight.current = false;
      setBusy((value) => (value === "checking" ? "" : value));
    }
  }

  /** Back to the form; focus: "Edit" goes to Subject, X / Escape back to Submit, which opened the modal. */
  function backToForm(focus: "subject" | "submit") {
    modalRun.current += 1;
    setPhase("form");
    setTimeout(() => (focus === "submit" ? submitButton.current : subjectInput.current)?.focus(), 0);
  }

  /** v3 §2: "Yes, this solved my issue" ends with the rating card for that answer. */
  function solved(answerId: string) {
    setRatingFor(answerId);
    setRating("idle");
    setPhase("rating");
  }

  /**
   * Hand over to a person: the ticket links the chat answers, the modal answers
   * the learner saw and the declined suggestion (if any). An alternative's
   * answer still loading is dropped: the learner never saw it.
   */
  function handOver(suggestionId: string | null) {
    if (inFlight.current) return;
    inFlight.current = true;
    modalRun.current += 1;
    setPicked((current) => (current?.status === "pending" ? null : current));
    void submitTicket(suggestionId).finally(() => { inFlight.current = false; });
  }

  function closeSuggestion(outcome: SuggestionOutcome, focus: "subject" | "submit" = "subject") {
    if (suggestion) reportSuggestionOutcome(suggestion.id, outcome);
    if (outcome === "solved") { if (suggestion) solved(suggestion.id); return; }
    if (outcome === "edited") { backToForm(focus); return; }
    if (!suggestion) return;
    handOver(suggestion.id);
  }

  /** v3 §1: a "You might be asking" question, asked like a starter chip (its FAQ id); the answer is Admin's FAQ text verbatim. */
  async function pickAlternative(item: HelpdeskAlternative) {
    if (picked?.status === "pending" || busy !== "") return;
    const run = modalRun.current;
    setPickError(false);
    setPicked({ status: "pending", faqId: item.faqId });
    const result = await askAssistant({ message: item.question, locale, faqId: item.faqId }, newIdempotencyKey());
    if (run !== modalRun.current || abandoned.current) return;
    // Only an answer the learner is shown is linked to the enquiry (a row with no answer is not).
    if (result.ok && result.data?.id && result.data.reply) {
      rememberSeen(result.data.id);
      setPicked({ status: "answer", faqId: item.faqId, id: result.data.id, reply: result.data.reply });
      return;
    }
    // No answer (the FAQ went away), 429 or a network failure: say so; the list and "None of these" stay.
    setPicked(null);
    setPickError(true);
  }

  /** The picked alternative's helpful row: Yes rates it, No hands over; the choice is also its Helpful? feedback. */
  function alternativeOutcome(helpful: boolean) {
    if (picked?.status !== "answer") return;
    void sendAssistantFeedback(picked.id, helpful, newIdempotencyKey());
    if (helpful) solved(picked.id);
    else handOver(null);
  }

  /** "Back to the questions": the same list again, nothing asked or reported. */
  function backToAlternatives() {
    setPicked(null);
    setPickError(false);
  }

  async function rate(stars: number) {
    if (!ratingFor || rating === "saving") return;
    const run = ++ratingRun.current;
    setRating("saving");
    const result = await rateAnswer(ratingFor, stars, newIdempotencyKey());
    // Skip while saving went on to the thanks step: what this save says no longer matters.
    if (abandoned.current || run !== ratingRun.current) return;
    // 409: this answer was rated already (the first rating is kept), so the card is done either way.
    if (result.ok || result.status === 409) { setRating("rated"); setPhase("thanks"); return; }
    setRating("error");
  }

  /** Skip is never blocked, not even by a save in flight (the card is optional). */
  function skipRating() {
    ratingRun.current += 1;
    setPhase("thanks");
  }

  /**
   * v4 Part B: the chat hands over to a person. The form is on this page, so
   * focus moves to it (Subject); the chat's assistIds go with the enquiry. A
   * sent enquiry makes way for a fresh form (same topic and email); while the
   * assistant modal is open the form is already in use, so nothing changes.
   */
  function openFormFromChat(chatIds: string[]) {
    assistIds.current = chatIds;
    if (busy !== "") return;
    if (phase === "success") {
      setCreated(null);
      setSubject("");
      setMessage("");
      attachments.clear();
      setLinkedOrder(null);
      setErrors({});
      setFormError("");
      setPhase("form");
      setTimeout(() => subjectInput.current?.focus(), 0);
      return;
    }
    if (phase === "form") subjectInput.current?.focus();
  }

  /** "We’d love to hear your ideas, too!": an Other Enquiries enquiry, starting at Subject. */
  function shareIdeas() {
    if (busy !== "" || phase === "success") return;
    setCategory("other");
    setErrors((current) => ({ ...current, category: undefined }));
    subjectInput.current?.focus();
  }

  function cancel() {
    abandoned.current = true;
    suggestionCheck.current?.abort();
    if (window.history.length > 1) router.back();
    else router.push(accountHome);
  }

  const fieldProps = (field: Field) => ({ id: `${ids}-${field}`, "aria-required": true, "aria-invalid": errors[field] ? true : undefined, "aria-describedby": errors[field] ? `${ids}-${field}-error` : undefined });
  const fieldError = (field: Field) => errors[field] ? <p id={`${ids}-${field}-error`} className="helpdesk-field-error">{errors[field]}</p> : null;
  const label = (field: Field, text: string) => <label className="helpdesk-label" id={`${ids}-${field}-label`} htmlFor={`${ids}-${field}`}>{text}<span aria-hidden="true">*</span></label>;
  const disabled = busy !== "";

  return <div className="helpdesk-card" onInputCapture={markInput} onKeyDownCapture={markInput} onPointerDownCapture={markInput}>
    <div className="helpdesk-card-content">
      {phase === "success" && created ? <SuccessPanel copy={copy} ticket={created} ticketHref={`/${locale}/account/my-learning/support/${created.id}`} enquiriesHref={enquiriesHref} /> :
        <form className="helpdesk-form" noValidate onSubmit={onSubmit} onPaste={attachments.onPaste}>
          <div className="helpdesk-form-title"><h1>{copy.pageTitle}</h1><Link prefetch={false} className="helpdesk-text-link" href={enquiriesHref}>{copy.myEnquiries}</Link></div>
          <div className="helpdesk-field">
            <span className="helpdesk-label" id={`${ids}-category-label`}>{copy.enquiryType}<span aria-hidden="true">*</span></span>
            <TopicSelect copy={copy} options={config.categories as TicketCategory[]} value={category} disabled={disabled} buttonProps={fieldProps("category")} labelledBy={`${ids}-category-label`}
              onChange={(value) => { setCategory(value); setErrors((current) => ({ ...current, category: undefined })); }} />
            {fieldError("category")}
          </div>
          {linkedOrder ? <div className="helpdesk-field helpdesk-order-field" role="group" aria-labelledby={`${ids}-order-label`}>
            {/* v4 Part A read-only order line: no Figma frame, 待视觉验收 (reuses .helpdesk-field / .helpdesk-label / .helpdesk-text-link). */}
            <span className="helpdesk-label" id={`${ids}-order-label`}>{copy.order.label}</span>
            <p className="helpdesk-order-line"><span className="helpdesk-order-number">{linkedOrder.id}</span>
              <button type="button" className="helpdesk-text-link helpdesk-order-remove" aria-label={fillTemplate(copy.order.removeLabel, { number: linkedOrder.id })} disabled={disabled} onClick={removeOrder}>{copy.order.remove}</button></p>
          </div> : null}
          {order ? <p className="helpdesk-visually-hidden" role="status" aria-live="polite">{orderNotice}</p> : null}
          {!order && orderUnavailable && phase === "form" ? <div className="helpdesk-field helpdesk-order-field" role="group" aria-labelledby={`${ids}-order-label`}>
            {/* v4 review: an order that could not be attached is said, not dropped silently (never which reason). No Figma frame, 待视觉验收. */}
            <span className="helpdesk-label" id={`${ids}-order-label`}>{copy.order.label}</span>
            <p className="helpdesk-order-line helpdesk-order-unavailable">{copy.order.unavailable}</p>
          </div> : null}
          <div className="helpdesk-field">{label("subject", copy.subject)}<input ref={subjectInput} {...fieldProps("subject")} className="helpdesk-input" maxLength={inputMaxLength(config.limits.subjectMax)} placeholder={copy.subjectPlaceholder} value={subject} disabled={disabled} onChange={(event) => setSubject(event.target.value)} />{fieldError("subject")}</div>
          <div className="helpdesk-field">{label("message", copy.message)}<textarea {...fieldProps("message")} className="helpdesk-input helpdesk-textarea" maxLength={inputMaxLength(config.limits.bodyMax)} placeholder={copy.messagePlaceholder} value={message} disabled={disabled} onChange={(event) => setMessage(event.target.value)} />{fieldError("message")}</div>
          <AttachmentZone copy={copy} config={config} attachments={attachments} disabled={disabled} inputId={`${ids}-files`} />
          <div className="helpdesk-field">{label("email", copy.email)}<input {...fieldProps("email")} className="helpdesk-input" type="email" autoComplete="email" maxLength={config.limits.emailMax} value={email} disabled={disabled} onChange={(event) => setEmail(event.target.value)} />{fieldError("email")}<p className="helpdesk-email-note">{copy.emailNote}</p></div>
          {formError ? <p role="alert" className="helpdesk-inline-error">{formError}</p> : null}
          <div className="helpdesk-form-actions">
            <button type="button" className="helpdesk-cancel-button" onClick={cancel} disabled={busy === "submitting"}>{copy.cancel}</button>
            <button ref={submitButton} type="submit" className="helpdesk-submit-button" disabled={disabled}>{busy === "checking" ? copy.assistant.checking : busy === "submitting" ? copy.submitting : copy.submit}</button>
          </div>
        </form>}
      <div className="helpdesk-divider" aria-hidden="true" />
      <AssistantChat locale={locale} copy={copy} questionMax={config.limits.questionMax} accountId={account.id} chips={chips} onIdeas={shareIdeas} onAssistIds={(ids) => { assistIds.current = ids; }} onHandover={openFormFromChat} pageInput={pageInput} />
    </div>
    {phase === "suggestion" || phase === "alternatives" || phase === "rating" || phase === "thanks" ? <AssistantModal copy={copy} locale={locale} stage={phase} suggestion={suggestion} busy={busy === "submitting"} accountHome={accountHome}
      enquiry={{ name: account.name, email: email.trim(), subject: subject.trim(), category: category as TicketCategory, message: message.trim(), askedAt: askedAt ?? new Date(), files: attachments.files }}
      alternatives={{ items: alternatives, picked, error: pickError, onPick: (item) => void pickAlternative(item), onOutcome: alternativeOutcome, onNone: () => handOver(null), onEdit: () => backToForm("subject"), onBack: backToAlternatives }}
      rating={{ state: rating, onRate: (stars) => void rate(stars), onSkip: skipRating }}
      onOutcome={closeSuggestion} onDismiss={() => (phase === "alternatives" ? backToForm("submit") : closeSuggestion("edited", "submit"))} /> : null}
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
  // Tabbing (or otherwise moving focus) out of the control closes the list.
  const onBlur = (event: FocusEvent<HTMLDivElement>) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); };
  return <div className={`helpdesk-select${open ? " is-open" : ""}`} ref={root} onBlur={onBlur}>
    <button type="button" role="combobox" {...buttonProps} aria-labelledby={labelledBy} aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} aria-activedescendant={open ? `${listId}-${active}` : undefined} disabled={disabled}
      className={`helpdesk-select-trigger${value ? " has-value" : ""}`} onClick={() => { setActive(Math.max(0, options.indexOf(value as TicketCategory))); setOpen((current) => !current); }} onKeyDown={onKeyDown}>
      <span>{value ? copy.categories[value] : copy.selectTopic}</span>{open ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
    </button>
    {open ? <ul className="helpdesk-select-options" role="listbox" id={listId} aria-labelledby={labelledBy}>
      {options.map((option, index) => <li key={option} id={`${listId}-${index}`} role="option" aria-selected={value === option} className={index === active ? "is-active" : undefined} onMouseEnter={() => setActive(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(index)}>{copy.categories[option]}</li>)}
    </ul> : null}
  </div>;
}

type Enquiry = { name: string; email: string; subject: string; category: TicketCategory; message: string; askedAt: Date; files: File[] };

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

type AlternativesProps = { items: HelpdeskAlternative[]; picked: Picked | null; error: boolean; onPick: (item: HelpdeskAlternative) => void; onOutcome: (helpful: boolean) => void; onNone: () => void; onEdit: () => void; onBack: () => void };
type RatingProps = { state: "idle" | "saving" | "error" | "rated"; onRate: (stars: number) => void; onSkip: () => void };

function AssistantModal({ copy, locale, stage, suggestion, enquiry, busy, accountHome, alternatives, rating, onOutcome, onDismiss }: { copy: HelpdeskCopy; locale: Locale; stage: "suggestion" | "alternatives" | "rating" | "thanks"; suggestion: HelpdeskSuggestion | null; enquiry: Enquiry; busy: boolean; accountHome: string; alternatives: AlternativesProps; rating: RatingProps; onOutcome: (outcome: SuggestionOutcome) => void; onDismiss: () => void }) {
  const ids = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const ratingCard = useRef<HTMLElement>(null);
  const answerHeading = useRef<HTMLHeadingElement>(null);
  /** The rating card and the thanks step have no way back to the form: no close button, Escape does nothing. */
  const locked = stage === "rating" || stage === "thanks";
  const latest = useRef({ locked, busy, onDismiss });
  latest.current = { locked, busy, onDismiss };
  useEffect(() => {
    dialog.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Modal: Escape closes it wherever focus is, and Tab / Shift+Tab stay inside it.
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const node = dialog.current;
      if (!node) return;
      if (event.key === "Escape") {
        if (!latest.current.locked && !latest.current.busy) { event.preventDefault(); latest.current.onDismiss(); }
        return;
      }
      if (event.key !== "Tab") return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const target = nextFocusIndex({ count: items.length, active: items.indexOf(document.activeElement as HTMLElement), shift: event.shiftKey });
      if (target === null) return;
      event.preventDefault();
      (target < 0 ? node : items[target]).focus();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => { document.removeEventListener("keydown", onKeyDown, true); document.body.style.overflow = previous; };
  }, []);
  // The rating card takes focus so it is read out; the thanks step keeps focus in the dialog (the clicked control is gone).
  useEffect(() => {
    if (stage === "rating") ratingCard.current?.focus();
    else if (stage === "thanks" && !dialog.current?.contains(document.activeElement)) dialog.current?.focus();
  }, [stage]);
  // A picked alternative's answer takes focus at its question, so it is read out; "Back to the questions" returns focus to that question's chip.
  const answered = alternatives.picked?.status === "answer" ? alternatives.picked : null;
  const backTo = useRef<string | null>(null);
  useEffect(() => {
    if (answered) { answerHeading.current?.focus(); return; }
    if (!backTo.current) return;
    dialog.current?.querySelector<HTMLButtonElement>(`button[data-faq-id="${backTo.current}"]`)?.focus();
    backTo.current = null;
  }, [answered]);
  // The chips are disabled while an answer loads, which drops focus; after a failure it goes back to the chip that was tried.
  const lastPicked = useRef<string | null>(null);
  useEffect(() => {
    if (!alternatives.error || !lastPicked.current) return;
    dialog.current?.querySelector<HTMLButtonElement>(`button[data-faq-id="${lastPicked.current}"]`)?.focus();
  }, [alternatives.error, alternatives.picked]);
  const name = firstName(enquiry.name);
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false }).format(enquiry.askedAt);
  const paragraphs = enquiry.message.split(/\n/);
  const pending = alternatives.picked?.status === "pending";
  const helpfulRow = (yes: () => void, no: () => void, edit: () => void) => <div className="helpdesk-modal-helpful">
    <p>{copy.assistant.helpful}</p>
    <div>
      <button type="button" className="helpdesk-feedback-button helpdesk-feedback-yes" disabled={busy} onClick={yes}><ThumbsUp size={14} aria-hidden="true" />{copy.assistant.yes}</button>
      <button type="button" className="helpdesk-feedback-button helpdesk-feedback-no" disabled={busy} onClick={no}><ThumbsDown size={14} aria-hidden="true" />{busy ? copy.submitting : copy.assistant.no}</button>
    </div>
    <button type="button" className="helpdesk-feedback-button" disabled={busy} onClick={edit}>{copy.assistant.edit}</button>
  </div>;
  // A press on the backdrop must not move focus to the page behind.
  return <div className="helpdesk-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) event.preventDefault(); }}>
    <div className="helpdesk-modal" role="dialog" aria-modal="true" aria-labelledby={`${ids}-title`} tabIndex={-1} ref={dialog}>
      <header className="helpdesk-modal-header">
        <div className="helpdesk-modal-heading"><span className="helpdesk-modal-icon"><Bot size={20} aria-hidden="true" /></span><div><h2 id={`${ids}-title`}>{copy.assistant.title}</h2><p>{stage === "alternatives" && !answered ? copy.assistant.alternativesSubtitle : copy.assistant.subtitle}</p></div></div>
        {locked ? null : <button type="button" className="helpdesk-modal-close" aria-label={copy.assistant.close} disabled={busy} onClick={onDismiss}><X size={14} aria-hidden="true" /></button>}
      </header>
      {locked ? <div className="helpdesk-modal-thanks">
        <div className="helpdesk-modal-thanks-status" role="status">
          <span className="helpdesk-success-icon"><Check size={22} aria-hidden="true" /></span>
          <h3>{copy.assistant.thanksTitle}</h3>
          {stage === "thanks" ? <>{rating.state === "rated" ? <p className="helpdesk-modal-rated">{copy.assistant.rated}</p> : null}<p>{copy.assistant.thanksBody}</p></> : null}
        </div>
        {stage === "rating" ? <section className="helpdesk-rating helpdesk-modal-rating" role="group" aria-labelledby={`${ids}-rate`} tabIndex={-1} ref={ratingCard}>
          {/* v3 §2 rating card: no Figma frame, 待视觉验收 (reuses .helpdesk-rating / .helpdesk-stars from the enquiry page). */}
          <h3 id={`${ids}-rate`}>{copy.assistant.rateTitle}</h3>
          <div className="helpdesk-stars">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" disabled={rating.state === "saving"} aria-label={fillTemplate(copy.assistant.rateStar, { n })} onClick={() => rating.onRate(n)}><Star size={22} aria-hidden="true" /></button>)}</div>
          {rating.state === "error" ? <p role="alert" className="helpdesk-inline-error">{copy.assistant.rateError}</p> : null}
          {/* Skip stays enabled while a star is saving: the card never traps the learner. */}
          <button type="button" className="helpdesk-secondary-button" onClick={rating.onSkip}>{copy.assistant.skip}</button>
        </section> : <Link prefetch={false} className="helpdesk-submit-button" href={accountHome}>{copy.assistant.backToAccount}</Link>}
      </div> : <>
        <div className="helpdesk-modal-body">
          <section className="helpdesk-modal-query">
            <span className="helpdesk-avatar" aria-hidden="true">{initials(enquiry.name, enquiry.email)}</span>
            <div className="helpdesk-modal-query-content">
              <div className="helpdesk-modal-query-title"><h3>{enquiry.subject}</h3><span className="helpdesk-type-tag">{copy.categories[enquiry.category]}</span></div>
              <p className="helpdesk-modal-meta">{enquiry.email} · {time}</p>
              <div className="helpdesk-modal-text">{paragraphs.map((line, index) => line ? <p key={index}>{line}</p> : <p key={index} className="is-blank">​</p>)}</div>
              {enquiry.files.length ? <div className="helpdesk-modal-files">{enquiry.files.map((file, index) => <FileSummaryChip key={index} name={file.name} size={file.size} image={file.type.startsWith("image/")} />)}</div> : null}
            </div>
          </section>
          <section className="helpdesk-modal-answer">
            <span className="helpdesk-bot-avatar" aria-hidden="true"><Bot size={18} /></span>
            <div className="helpdesk-modal-answer-content">
              {stage === "suggestion" && suggestion ? <>
                <p className="helpdesk-answer-greeting">{name ? fillTemplate(copy.assistant.greeting, { name }) : copy.assistant.greetingNoName}</p>
                <Markdown className="helpdesk-answer-markdown" text={suggestion.answer} />
              </> : answered ? <>
                {/* v3: the way back to the "You might be asking" list; no Figma frame, 待视觉验收 (a text button in the 1333:249 answer box). */}
                <button type="button" className="helpdesk-answer-back" disabled={busy} onClick={() => { backTo.current = answered.faqId; alternatives.onBack(); }}><ChevronLeft size={14} aria-hidden="true" />{copy.assistant.backToQuestions}</button>
                <h3 className="helpdesk-answer-greeting helpdesk-answer-question" tabIndex={-1} ref={answerHeading}>{answered.reply.question}</h3>
                <Markdown className="helpdesk-answer-markdown" text={answered.reply.answer} />
              </> : <>
                {/* v3 §1 "You might be asking": no Figma frame, 待视觉验收 (reuses .helpdesk-chat-chip inside the 1333:249 answer box). */}
                <h3 className="helpdesk-answer-greeting" id={`${ids}-alternatives`}>{copy.assistant.alternativesTitle}</h3>
                <ul className="helpdesk-chat-chips helpdesk-modal-alternatives" aria-labelledby={`${ids}-alternatives`} aria-busy={pending}>
                  {alternatives.items.map((item) => <li key={item.faqId}><button type="button" className="helpdesk-chat-chip" title={item.question} data-faq-id={item.faqId} disabled={pending || busy} onClick={() => { lastPicked.current = item.faqId; alternatives.onPick(item); }}><span>{item.question}</span><ChevronRight size={14} aria-hidden="true" /></button></li>)}
                </ul>
                {alternatives.error ? <p role="alert" className="helpdesk-inline-error">{copy.assistant.alternativeError}</p> : null}
              </>}
            </div>
          </section>
        </div>
        {stage === "alternatives" ? <p className="helpdesk-visually-hidden helpdesk-modal-live" role="status" aria-live="polite">{pending ? copy.assistant.alternativeLoading : ""}</p> : null}
        <footer className="helpdesk-modal-footer">
          {stage === "suggestion" ? helpfulRow(() => onOutcome("solved"), () => onOutcome("declined"), () => onOutcome("edited"))
            : answered ? helpfulRow(() => alternatives.onOutcome(true), () => alternatives.onOutcome(false), alternatives.onEdit)
            : <div className="helpdesk-modal-helpful">
              <p>{copy.assistant.alternativesHint}</p>
              {/* GB/T 47746-2026: the way to a person stays visible whenever alternatives are shown. */}
              <div><button type="button" className="helpdesk-feedback-button helpdesk-feedback-no helpdesk-feedback-none" disabled={busy} onClick={alternatives.onNone}>{busy ? copy.submitting : copy.assistant.noneOfThese}</button></div>
              <button type="button" className="helpdesk-feedback-button" disabled={busy} onClick={alternatives.onEdit}>{copy.assistant.edit}</button>
            </div>}
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

