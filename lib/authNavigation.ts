export function authNavigationHref(locale: string, mode: "sign-in" | "sign-up", currentUrl: string) {
  const current = new URL(currentUrl);
  const authPage = /\/(?:portal\/)?(?:sign-in|sign-up|forgot-password|reset-password|check-email|password-reset-sent|verify-email)\/?$/.test(current.pathname);
  const returnTo = authPage
    ? current.searchParams.get("returnTo") || `/${locale}/account/my-learning`
    : current.pathname + current.search + current.hash;
  return `/${locale}/portal/${mode}?returnTo=${encodeURIComponent(returnTo)}`;
}
