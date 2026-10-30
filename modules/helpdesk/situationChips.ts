// Helpdesk v5 Part A §3: which chips the chat greeting shows, chosen by code.
// At most 3: first the published FAQs (or, once Admin has a release, its entry
// nodes) whose signals match the learner's, by signal priority (FAQ_SIGNALS
// order), then popular ones fill the rest; each once, and the same inputs
// always give the same chips (within one signal, and among popular ones, in
// the order Admin lists them). The chip text is the FAQ question as staff
// wrote it, so it never carries an amount, an order number or a date of the
// learner's. open_ticket_waiting is not an FAQ: it is the fixed "your enquiry
// is waiting for your reply" card (waitingTicket) linking the enquiry.
// Pure: no I/O.
import { FAQ_SIGNALS, type FaqSignal, type SituationChip, type SituationSignal, type TicketStatus } from "@/contracts/helpdesk";

// Figma 1394:30 draws 3 chips (owner 2026-10-30: align to the design; the v5 spec said 4).
export const SITUATION_CHIPS_MAX = 3;

/** A chip candidate: a published FAQ (per-FAQ list) or a release entry node. */
export type ChipCandidate = { id: string; question: string; popular: boolean; signals: readonly FaqSignal[] };

export type ChosenChips = {
  chips: SituationChip[];
  /** At least one chip came from a signal (the "you may be having" title). */
  situational: boolean;
  /** The FAQ signals that produced chips (enum names only; logged with the session). */
  matched: FaqSignal[];
};

export function chooseSituationChips(signals: readonly SituationSignal[], candidates: readonly ChipCandidate[], max = SITUATION_CHIPS_MAX): ChosenChips {
  const chips: SituationChip[] = [];
  const matched: FaqSignal[] = [];
  const seen = new Set<string>();
  const usable = candidates.filter((item) => item.id && item.question.trim());
  const add = (item: ChipCandidate, reason: SituationChip["reason"]) => {
    const id = item.id.toLowerCase();
    if (chips.length >= max || seen.has(id)) return false;
    seen.add(id);
    chips.push({ id, question: item.question, reason });
    return true;
  };
  for (const signal of FAQ_SIGNALS) {
    if (!signals.includes(signal)) continue;
    for (const item of usable) if (item.signals.includes(signal) && add(item, "signal") && !matched.includes(signal)) matched.push(signal);
  }
  for (const item of usable) if (item.popular) add(item, "popular");
  return { chips, situational: chips.some((chip) => chip.reason === "signal"), matched };
}

/** The newest of the learner's enquiries that waits for their reply (the fixed card), or null. */
export function waitingTicketOf<T extends { id: string; number: string; status: TicketStatus; updatedAt: string }>(tickets: readonly T[]): { id: string; number: string } | null {
  const waiting = tickets.filter((ticket) => ticket.status === "WAITING_USER").sort((a, b) => (a.updatedAt === b.updatedAt ? (a.id < b.id ? 1 : -1) : a.updatedAt < b.updatedAt ? 1 : -1))[0];
  return waiting ? { id: waiting.id, number: waiting.number } : null;
}
