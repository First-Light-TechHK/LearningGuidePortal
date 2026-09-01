"use client";

export function SignOutButton({ label, locale }: { label: string; locale: "en-GB" | "zh-CN" }) {
  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign(`/${locale}/portal`);
  }
  return <button className="portal-text-button" onClick={signOut} type="button">{label}</button>;
}
