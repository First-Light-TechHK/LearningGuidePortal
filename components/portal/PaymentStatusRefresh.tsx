"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function PaymentStatusRefresh({ pending, retryLabel }: { pending: boolean; retryLabel: string }) {
  const router = useRouter();
  useEffect(() => {
    if (!pending) return;
    let attempts = 0;
    const timer = setInterval(() => {
      router.refresh();
      if (++attempts >= 15) clearInterval(timer);
    }, 2000);
    return () => clearInterval(timer);
  }, [pending, router]);
  return pending ? <button className="portal-button portal-button-secondary" onClick={() => router.refresh()}>{retryLabel}</button> : null;
}
