import { AntdRegistry } from "@ant-design/nextjs-registry";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { isLocale } from "@/lib/i18n/config";
import { PortalProvider } from "@/components/portal/ui/PortalProvider";

export default async function PortalControlsLayout({ children, params }: {
  children: ReactNode; params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <AntdRegistry hashPriority="high"><PortalProvider locale={locale}>{children}</PortalProvider></AntdRegistry>;
}
