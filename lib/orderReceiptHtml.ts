import type { OrderReceipt } from "@/contracts/order-receipt";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { formatPlanPrice } from "@/lib/planPricing";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character);
}

export function orderReceiptHtml(receipt: OrderReceipt, locale: Locale) {
  const copy = getMessages(locale).orderReceipt;
  const date = receipt.paidAt ? new Date(receipt.paidAt).toLocaleString(locale, { timeZone: "UTC", timeZoneName: "short" }) : copy.unavailableDate;
  const rows = [[copy.plan, receipt.planName || copy.unknownPlan], [copy.order, receipt.orderId], [copy.date, date], [copy.amount, formatPlanPrice(locale, receipt)], [copy.payment, receipt.paymentMode === "stripe" ? copy.stripe : copy.demo]];
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(copy.title)}</title><style>body{font-family:Arial,sans-serif;max-width:680px;margin:48px auto;padding:0 16px;color:#17324d}h1{font-size:28px}dl{display:grid;grid-template-columns:minmax(100px,170px) minmax(0,1fr);gap:12px;padding:24px;border:1px solid #d6e1e9}dt{font-weight:700}dd{margin:0;overflow-wrap:anywhere}@media(max-width:400px){dl{grid-template-columns:1fr;padding:16px}dd{margin-bottom:12px}}</style></head><body><h1>${escapeHtml(copy.title)}</h1><dl>${rows.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join("")}</dl></body></html>`;
}
