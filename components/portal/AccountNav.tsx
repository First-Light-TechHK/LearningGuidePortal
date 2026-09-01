import Link from "next/link";

export function AccountNav({ locale, copy }: { locale: "en-GB" | "zh-CN"; copy: { overview: string; subscription: string; notifications: string; settings: string; help: string } }) {
  return <nav className="account-nav" aria-label="Account navigation"><Link href={`/${locale}/account/my-learning`}>{copy.overview}</Link><Link href={`/${locale}/account/my-learning/subscription`}>{copy.subscription}</Link><Link href={`/${locale}/account/my-learning/notifications`}>{copy.notifications}</Link><Link href={`/${locale}/account/my-learning/settings`}>{copy.settings}</Link><Link href={`/${locale}/account/my-learning/help`}>{copy.help}</Link></nav>;
}
