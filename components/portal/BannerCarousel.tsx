import type { Locale } from "@/lib/i18n/config";
import { getPortalContent } from "@/services/productStore";
import { BannerSlides } from "./BannerSlides";
import { getMessages } from "@/lib/i18n/messages";

export async function BannerCarousel({ locale, home = false }: { locale: Locale; home?: boolean }) {
  const content = await getPortalContent();
  const copy = getMessages(locale).homeDesign;
  const homeOverrides = [
    { eyebrow: "", title: copy.heroTitle, text: copy.heroDescription, cta: copy.explore, href: `/${locale}/portal/courses` },
    { eyebrow: "", title: copy.banner2Title, text: copy.banner2Description, cta: copy.banner2Cta, href: `/${locale}/portal#why-us` },
    { eyebrow: "", title: copy.banner3Title, text: copy.banner3Description, cta: copy.banner3Cta, href: `/${locale}/portal/study-groups` }
  ] as const;
  const items = home ? content.banners[locale].slice(0, 3).map((banner, index) => ({
    ...banner,
    image: `/portal/banner${index + 1}.png`,
    ...homeOverrides[index]
  })) : content.banners[locale];
  return <BannerSlides locale={locale} items={items} home={home} />;
}
