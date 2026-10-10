import { PortalFooter } from "@/components/portal/PortalFooter";
import { StudyGroupHeader } from "@/components/portal/StudyGroupHeader";
import { StudySessionRoom } from "@/components/portal/StudySessionRoom";
import { localeFrom } from "@/lib/i18n/config";
import { currentProductUser } from "@/services/productAuth";
import styles from "@/components/portal/study-groups.module.css";

export default async function StudySessionPage({ params }: { params: Promise<{ locale: string; sessionId: string }> }) {
  const { locale: localeParam, sessionId } = await params;
  const locale = localeFrom(localeParam);
  const user = await currentProductUser();
  return (
    <main className={styles.page}>
      <StudyGroupHeader locale={locale} signedIn={Boolean(user)} displayName={user?.nickname} />
      <StudySessionRoom locale={locale} sessionId={sessionId} />
      <PortalFooter locale={locale} />
    </main>
  );
}
