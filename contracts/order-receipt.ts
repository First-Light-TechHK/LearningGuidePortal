// Read-only receipt projection. Never contains card/account balance information.
export type OrderReceipt = {
  orderId: string;
  planName: string;
  amountMinor: number;
  currency: string;
  paidAt: string | null;
  paymentMode: "stripe" | "demo";
};
