// BackOffice HelpDesk data tab: daily ticket numbers (GET /api/integration/helpdesk/ticket-stats).
// Read-only, labels and counts only: no learner, subject, body or staff name leaves Portal here.
// One pure function does the counting for both stores, so the file store and PostgreSQL answer alike;
// the repository only hands over the times (opened, closed, first public staff reply) and the close reason.
import type { TicketDay, TicketStatsQuery, TicketStatsResponse } from "@/contracts/helpdesk";
import type { HelpdeskRepository, TicketTiming } from "./repository";

const DAY = 86_400_000;

/** Linear interpolation between the closest ranks (PostgreSQL percentile_cont), rounded to 0.1 minute. */
export function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const at = (sorted.length - 1) * p;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  const value = sorted[low] + (sorted[high] - sorted[low]) * (at - low);
  return Math.round(value * 10) / 10;
}

const minutes = (timing: TicketTiming) =>
  timing.firstReplyAt === null ? null : Math.max(0, (Date.parse(timing.firstReplyAt) - Date.parse(timing.createdAt)) / 60_000);

function replyNumbers(timings: readonly TicketTiming[]) {
  const waits = timings.map(minutes).filter((value): value is number => value !== null).sort((a, b) => a - b);
  return { firstReplies: waits.length, firstReplyMedianMinutes: percentile(waits, 0.5), firstReplyP90Minutes: percentile(waits, 0.9) };
}

export function ticketStats(timings: readonly TicketTiming[], query: TicketStatsQuery): TicketStatsResponse {
  const start = Date.parse(`${query.from}T00:00:00.000Z`);
  const end = Date.parse(`${query.to}T00:00:00.000Z`) + DAY;
  const days: TicketDay[] = [];
  for (let dayStart = start; dayStart < end; dayStart += DAY) {
    const dayEnd = dayStart + DAY;
    const inDay = (iso: string | null) => iso !== null && Date.parse(iso) >= dayStart && Date.parse(iso) < dayEnd;
    const opened = timings.filter((t) => inDay(t.createdAt));
    const closed = timings.filter((t) => inDay(t.closedAt));
    days.push({
      day: new Date(dayStart).toISOString().slice(0, 10),
      created: opened.length,
      resolved: closed.filter((t) => t.closeReason !== "cancelled").length,
      cancelled: closed.filter((t) => t.closeReason === "cancelled").length,
      openAtEnd: timings.filter((t) => Date.parse(t.createdAt) < dayEnd && (t.closedAt === null || Date.parse(t.closedAt) >= dayEnd)).length,
      ...replyNumbers(opened)
    });
  }
  const opened = timings.filter((t) => Date.parse(t.createdAt) >= start && Date.parse(t.createdAt) < end);
  return {
    from: query.from, to: query.to, timeZone: "UTC", days,
    totals: {
      created: opened.length,
      resolved: days.reduce((sum, d) => sum + d.resolved, 0),
      cancelled: days.reduce((sum, d) => sum + d.cancelled, 0),
      ...replyNumbers(opened)
    }
  };
}

export function createTicketStatsService(deps: { repository: Pick<HelpdeskRepository, "listTicketTimings"> }) {
  return {
    async stats(query: TicketStatsQuery): Promise<TicketStatsResponse> {
      const start = `${query.from}T00:00:00.000Z`;
      const end = new Date(Date.parse(`${query.to}T00:00:00.000Z`) + DAY).toISOString();
      return ticketStats(await deps.repository.listTicketTimings({ createdBeforeIso: end, openAtOrAfterIso: start }), query);
    }
  };
}
export type TicketStatsService = ReturnType<typeof createTicketStatsService>;
