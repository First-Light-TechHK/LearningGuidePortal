import type { Locale } from "@/lib/i18n/config";
import { getPortalContent } from "@/services/productStore";
import { BannerSlides } from "./BannerSlides";
import { getMessages } from "@/lib/i18n/messages";

export async function BannerCarousel({ locale, home = false }: { locale: Locale; home?: boolean }) {
  const content = await getPortalContent();
  const copy = getMessages(locale).homeDesign;
  const items = home ? content.banners[locale].slice(0, 3).map((banner, index) => ({
    ...banner,
    image: `/portal/banner${index + 1}.png`,
    ...(index === 0 ? { eyebrow: "", title: copy.heroTitle, text: copy.heroDescription, cta: copy.explore } : {}),
  })) : content.banners[locale];
  return <BannerSlides locale={locale} items={items} home={home} />;
}
