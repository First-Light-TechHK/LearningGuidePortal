import { PortalFooter } from "@/components/portal/PortalFooter";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { StudySessionEntry } from "@/components/portal/StudySessionEntry";
import { localeFrom } from "@/lib/i18n/config";
import { currentProductUser } from "@/services/productAuth";
import styles from "@/components/portal/study-groups.module.css";

export default async function StudySessionPage({ params }: { params: Promise<{ locale: string; sessionId: string }> }) {
  const { locale: localeParam, sessionId } = await params;
  const locale = localeFrom(localeParam);
  const user = await currentProductUser();
  return (
    <main className={styles.page}>
      <PortalHeader locale={locale} active="study-groups" signedIn={Boolean(user)} displayName={user?.nickname} avatarUrl={user?.avatarPath ? "/api/my-learning/avatar" : undefined} />
      <StudySessionEntry locale={locale} sessionId={sessionId} />
      <PortalFooter locale={locale} />
    </main>
  );
}
