import type { Locale } from "@/lib/i18n/config";
import { getPortalContent } from "@/services/productStore";
import { BannerSlides } from "./BannerSlides";

export async function BannerCarousel({ locale }: { locale: Locale }) {
  const content = await getPortalContent();
  return <BannerSlides locale={locale} items={content.banners[locale]} />;
}
