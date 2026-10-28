"use client";
// Learner enquiry page (no Figma frame yet: 待视觉验收). The server's
// allowedActions decide which controls show; every write carries the shown
// expectedSequence and an Idempotency-Key, and a 404 / 409 (stale, wrong
// state, window passed, already rated) reloads the ticket so stale controls go.
import Link from "next/link";
import { ArrowLeft, Star } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { TicketDetail } from "@/contracts/helpdesk";
import { conversationItems, fileSignature, fillTemplate, inputMaxLength, isValidText, problemMessageKey, relativeTime, reloadsTicket, SubmissionKeys, type HelpdeskUiConfig } from "@/modules/helpdesk/learnerUi";
import { loadTicket, newIdempotencyKey, sendTicketAction, sendTicketMessage, type ApiFailure } from "./helpdeskApi";
import { AttachmentZone, LinkifiedText, MessageAttachments, StatusPill, useAttachments, type HelpdeskCopy } from "./HelpdeskParts";
import "./helpdesk.css";

type Locale = "en-GB" | "zh-CN";

export function EnquiryDetail({ locale, copy, config, initial }: { locale: Locale; copy: HelpdeskCopy; config: HelpdeskUiConfig; initial: TicketDetail }) {
  const ids = useId();
  const [ticket, setTicket] = useState(initial);
  const [reply, setReply] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string>("");
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const attachments = useAttachments(config, copy, busy !== "");
  const keys = useRef(new SubmissionKeys(newIdempotencyKey));
  const inFlight = useRef(false);
  const allowed = new Set(ticket.allowedActions);
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  // Server and browser time zones differ; the browser's wording wins after hydration.
  const stamp = (iso: string) => <time dateTime={iso} suppressHydrationWarning>{dateTime.format(new Date(iso))}</time>;
  const withTime = (template: string, iso: string) => { const [before, after = ""] = template.split("{time}"); return <>{before}{stamp(iso)}{after}</>; };

  // Relative times are computed after hydration so server and client markup agree.
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  async function handleFailure(result: ApiFailure) {
    if (result.status >= 400 && result.status < 500) keys.current.done();
    const key = problemMessageKey(result.status, result.code);
    if (reloadsTicket(result.status)) {
      const fresh = await loadTicket(ticket.id);
      if (fresh.ok) setTicket(fresh.data);
      // "Updated" only when the page now shows the new state.
      setNotice(key === "conflict" ? (fresh.ok ? copy.detail.updated : copy.errors.unavailable) : copy.errors[key]);
      return;
    }
    setNotice(copy.errors[key]);
  }

  async function run(name: string, send: () => Promise<{ ok: true; data: TicketDetail } | ApiFailure>, after?: () => void) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(name);
    setNotice("");
    try {
      const result = await send();
      if (result.ok) {
        keys.current.done();
        setTicket(result.data);
        setConfirmWithdraw(false);
        after?.();
      } else await handleFailure(result);
    } finally {
      inFlight.current = false;
      setBusy("");
    }
  }

  function action(name: "cancel" | "confirm" | "reject" | "close" | "rate", extra: { rating?: number } = {}) {
    const body = { action: name, expectedSequence: ticket.sequence, ...extra };
    const key = keys.current.keyFor(JSON.stringify({ id: ticket.id, ...body }));
    return run(name, () => sendTicketAction(ticket.id, body, key));
  }

  function sendReply() {
    const body = reply.trim();
    if (!isValidText(reply, config.limits.bodyMax)) { setNotice(copy.validation.message); return; }
    const form = new FormData();
    form.append("body", body);
    form.append("expectedSequence", String(ticket.sequence));
    for (const file of attachments.files) form.append("files[]", file, file.name);
    const key = keys.current.keyFor(JSON.stringify({ id: ticket.id, body, sequence: ticket.sequence }) + fileSignature(attachments.files));
    return run("reply", () => sendTicketMessage(ticket.id, form, key), () => { setReply(""); attachments.clear(); });
  }

  const busyAny = busy !== "";
  const closed = ticket.status === "CLOSED";
  return <article className="helpdesk-detail">
    <Link prefetch={false} className="helpdesk-back-link" href={`/${locale}/account/my-learning/support/enquiries`}><ArrowLeft size={16} aria-hidden="true" />{copy.detail.back}</Link>
    <header className="helpdesk-detail-header">
      <p className="helpdesk-detail-number">{ticket.number} · {copy.categories[ticket.category]}</p>
      <div className="helpdesk-detail-title"><h1>{ticket.subject}</h1><StatusPill status={ticket.status} copy={copy} /></div>
      <p className="helpdesk-detail-meta">{withTime(copy.detail.submittedOn, ticket.createdAt)} · {ticket.contactEmail}</p>
    </header>

    {notice ? <p role="alert" className="helpdesk-inline-error helpdesk-detail-notice">{notice}</p> : null}

    {allowed.has("confirm") ? <section className="helpdesk-confirm-banner" aria-labelledby={`${ids}-confirm`}>
      <div><h2 id={`${ids}-confirm`}>{copy.detail.confirmPrompt}</h2>{ticket.confirmDueAt && now !== null ? <p>{fillTemplate(copy.detail.autoConfirm, { time: relativeTime(ticket.confirmDueAt, now, locale) })}</p> : null}</div>
      <div className="helpdesk-confirm-actions">
        <button type="button" className="helpdesk-submit-button" disabled={busyAny} onClick={() => action("confirm")}>{copy.detail.confirmYes}</button>
        <button type="button" className="helpdesk-secondary-button" disabled={busyAny} onClick={() => action("reject")}>{copy.detail.confirmNo}</button>
      </div>
    </section> : null}

    <ol className="helpdesk-conversation">{conversationItems(ticket).map((item) => item.kind === "event"
      ? <li key={item.event.id} className="helpdesk-event"><span>{eventText(copy, item.event.type, item.event.actor.name)}</span>{stamp(item.at)}</li>
      : <li key={item.message.id} className={`helpdesk-message helpdesk-message-${item.message.authorKind}`}>
        <p className="helpdesk-message-author"><strong>{item.message.authorKind === "learner" ? copy.detail.you : item.message.authorName || copy.detail.supportTeam}</strong>{stamp(item.at)}</p>
        <div className="helpdesk-message-body">{item.message.body.split(/\n/).map((line, index) => <p key={index}>{line ? <LinkifiedText text={line} /> : "​"}</p>)}</div>
        <MessageAttachments attachments={item.message.attachments} copy={copy} />
      </li>)}</ol>

    {allowed.has("rate") || ticket.rating !== null ? <section className="helpdesk-rating" aria-labelledby={`${ids}-rate`}>
      {ticket.rating !== null ? <p role="status">{fillTemplate(copy.detail.rated, { n: ticket.rating })}</p> : <>
        <h2 id={`${ids}-rate`}>{copy.detail.rateTitle}</h2>
        <div className="helpdesk-stars">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" disabled={busyAny} aria-label={fillTemplate(copy.detail.rateStar, { n })} onClick={() => action("rate", { rating: n })}><Star size={22} aria-hidden="true" /></button>)}</div>
      </>}
    </section> : null}

    {allowed.has("reply") ? <form className="helpdesk-composer" noValidate onPaste={attachments.onPaste} onSubmit={(event) => { event.preventDefault(); void sendReply(); }}>
      <label className="helpdesk-label" htmlFor={`${ids}-reply`}>{copy.detail.replyLabel}</label>
      {closed && ticket.followUpUntil && now !== null ? <p className="helpdesk-composer-hint">{withTime(copy.detail.followUpHint, ticket.followUpUntil)}</p> : null}
      <textarea id={`${ids}-reply`} className="helpdesk-input helpdesk-textarea" maxLength={inputMaxLength(config.limits.bodyMax)} placeholder={copy.detail.replyPlaceholder} value={reply} disabled={busyAny} onChange={(event) => setReply(event.target.value)} />
      <AttachmentZone copy={copy} config={config} attachments={attachments} disabled={busyAny} inputId={`${ids}-files`} />
      <div className="helpdesk-composer-actions">
        <div className="helpdesk-composer-secondary">
          {allowed.has("close") ? <button type="button" className="helpdesk-secondary-button" disabled={busyAny} onClick={() => action("close")}>{copy.detail.solved}</button> : null}
          {allowed.has("cancel") && !confirmWithdraw ? <button type="button" className="helpdesk-cancel-button" disabled={busyAny} onClick={() => setConfirmWithdraw(true)}>{copy.detail.withdraw}</button> : null}
        </div>
        <button type="submit" className="helpdesk-submit-button" disabled={busyAny}>{busy === "reply" ? copy.detail.sending : closed ? copy.detail.followUp : copy.detail.send}</button>
      </div>
      {confirmWithdraw ? <div className="helpdesk-withdraw-confirm" role="group" aria-labelledby={`${ids}-withdraw`}>
        <p id={`${ids}-withdraw`}>{copy.detail.withdrawConfirm}</p>
        <div><button type="button" className="helpdesk-danger-button" disabled={busyAny} onClick={() => action("cancel")}>{copy.detail.withdrawYes}</button><button type="button" className="helpdesk-secondary-button" disabled={busyAny} onClick={() => setConfirmWithdraw(false)}>{copy.detail.keep}</button></div>
      </div> : null}
    </form> : <p className="helpdesk-readonly-note">{ticket.status === "CANCELLED" ? copy.detail.cancelledNote : copy.detail.closedNote}</p>}
  </article>;
}

function eventText(copy: HelpdeskCopy, type: string, actorName: string | null) {
  const events = copy.detail.events;
  if (type === "claimed") return actorName ? fillTemplate(events.claimed, { name: actorName }) : events.claimedNoName;
  return (events as Record<string, string>)[type] ?? type;
}
