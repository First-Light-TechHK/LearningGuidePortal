import { currentProductUser } from "@/services/productAuth";
import { getPaidOrderReceipt } from "@/services/subscriptionPaymentService";

export const runtime = "nodejs";

function escapeHtml(value: string) {
  return value.replace(/[&<>\"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character] || character);
}

export async function GET(_request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const user = await currentProductUser();
  if (!user) return new Response("Sign in is required.", { status: 401 });
  const receipt = await getPaidOrderReceipt(user.id, (await params).orderId);
  if (receipt.kind === "unavailable") return new Response("Receipt is not available for this order.", { status: 404 });
  if (receipt.kind === "redirect") return Response.redirect(receipt.url, 302);

  const order = receipt.order;
  const locale = user.locale === "zh-CN" ? "zh-CN" : "en-GB";
  const title = escapeHtml(order.plan?.name || "Learning Guide course");
  const date = new Date(order.createdAt).toLocaleString(locale);
  const amount = `${(order.amountMinor / 100).toFixed(2)} ${order.currency.toUpperCase()}`;
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><title>Learning Guide receipt</title><style>body{font-family:Arial,sans-serif;max-width:680px;margin:48px auto;color:#17324d}h1{font-size:28px}dl{display:grid;grid-template-columns:170px 1fr;gap:12px;padding:24px;border:1px solid #d6e1e9}dt{font-weight:700}dd{margin:0}</style></head><body><h1>Learning Guide receipt</h1><dl><dt>Course plan</dt><dd>${title}</dd><dt>Order</dt><dd>${escapeHtml(order.id)}</dd><dt>Date</dt><dd>${escapeHtml(date)}</dd><dt>Amount</dt><dd>${escapeHtml(amount)}</dd><dt>Payment</dt><dd>Demo payment</dd></dl></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `inline; filename="learning-guide-receipt-${order.id}.html"` } });
}
