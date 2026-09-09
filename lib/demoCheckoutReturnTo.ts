export function demoCheckoutSignInReturnTo(locale: string, orderId?: string) {
  const checkout = `/${locale}/portal/payment/checkout`;
  return orderId ? `${checkout}?orderId=${encodeURIComponent(orderId)}` : checkout;
}
