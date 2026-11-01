// Read-only provider destination, resolved from the original verified payment.
export type HostedOrderReceipt = {
  kind: "invoice" | "charge";
  url: string;
};

// Local development/demo receipt only. Stripe payments use HostedOrderReceipt.
export type OrderReceipt = {
  orderId: string;
  planName: string;
  amountMinor: number;
  currency: string;
  paidAt: string | null;
  paymentMode: "stripe" | "demo";
};
