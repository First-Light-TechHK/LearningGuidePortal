import type { NotificationLanguage } from "./types";

/**
 * HKT presentation rules (PRD §4.4 and §9.2).
 * English dates: "16 Nov 2026". Chinese dates: "2026年11月16日".
 * Times always carry the zone: "7:00 PM (HKT)".
 */

const HKT = "Asia/Hong_Kong";
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type HktParts = { year: number; month: number; day: number; hour: number; minute: number };

function hktParts(value: string | number | Date): HktParts | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: HKT,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function dateKey(parts: HktParts) {
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatHktDate(value: string | number | Date, language: NotificationLanguage): string {
  const parts = hktParts(value);
  if (!parts) return String(value);
  if (language === "zh") return `${parts.year}年${parts.month}月${parts.day}日`;
  return `${parts.day} ${MONTHS_EN[parts.month - 1]} ${parts.year}`;
}

/** "7:00 PM (HKT)" / "19:00 (HKT)". */
export function formatHktDateTimeHkt(value: string | number | Date, language: NotificationLanguage): string {
  const parts = hktParts(value);
  if (!parts) return String(value);
  if (language === "zh") return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")} (HKT)`;
  const suffix = parts.hour < 12 ? "AM" : "PM";
  const hour12 = parts.hour % 12 === 0 ? 12 : parts.hour % 12;
  return `${hour12}:${String(parts.minute).padStart(2, "0")} ${suffix} (HKT)`;
}

/** "16 Nov 2026, 7:00 PM (HKT)". */
export function formatHktDateTime(value: string | number | Date, language: NotificationLanguage): string {
  return `${formatHktDate(value, language)}, ${formatHktDateTimeHkt(value, language)}`;
}

/**
 * "US$149.00". Numbers are minor units (cents), matching Stripe amounts in the
 * Portal. Strings are already-presented amounts and pass through unchanged.
 */
export function formatAmount(value: number | string, language: NotificationLanguage = "en"): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return trimmed;
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
    value = Number(trimmed);
  }
  if (!Number.isFinite(value)) return String(value);
  const absolute = Math.abs(value / 100);
  const formatted = absolute.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `US$${value < 0 ? "-" : ""}${formatted}`;
}

export function formatPoints(value: number | string): string {
  const numeric = typeof value === "number" ? value : Number(String(value).replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(numeric)) return String(value);
  return Math.round(numeric).toLocaleString("en-GB");
}

/**
 * PRD §9.2: "2 hours ago" within 24 hours, "Yesterday, 6:50 PM", then
 * "30 Oct 2026". Both the comparison and the printed time use HKT.
 */
export function formatRelativeTime(createdAt: string, now: string | Date, language: NotificationLanguage): string {
  const created = new Date(createdAt);
  const current = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(created.getTime()) || Number.isNaN(current.getTime())) return formatHktDate(createdAt, language);
  const diffMs = current.getTime() - created.getTime();
  if (diffMs < 0) return language === "zh" ? "刚刚" : "Just now";
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return language === "zh" ? "刚刚" : "Just now";
  if (minutes < 60) return language === "zh" ? `${minutes} 分钟前` : `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  if (diffMs < 24 * 3600000) {
    const hours = Math.floor(diffMs / 3600000);
    return language === "zh" ? `${hours} 小时前` : `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }
  const createdParts = hktParts(created);
  const currentParts = hktParts(current);
  if (createdParts && currentParts) {
    const yesterday = new Date(current.getTime() - 86400000);
    const yesterdayParts = hktParts(yesterday);
    if (yesterdayParts && dateKey(createdParts) === dateKey(yesterdayParts)) {
      const time = formatHktDateTimeHkt(created, language).replace(" (HKT)", "");
      return language === "zh" ? `昨天 ${time}` : `Yesterday, ${time}`;
    }
  }
  return formatHktDate(created, language);
}
