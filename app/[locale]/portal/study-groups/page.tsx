import { PortalFooter } from "@/components/portal/PortalFooter";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { StudyGroupsApp } from "@/components/portal/StudyGroupsApp";
import { currentProductUser } from "@/services/productAuth";
import { localeFrom } from "@/lib/i18n/config";
import styles from "@/components/portal/study-groups.module.css";

export default async function StudyGroupsPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  const user = await currentProductUser();
  return (
    <main className={styles.page}>
      <PortalHeader locale={locale} active="study-groups" signedIn={Boolean(user)} displayName={user?.nickname} avatarUrl={user?.avatarPath ? "/api/my-learning/avatar" : undefined} />
      <StudyGroupsApp locale={locale} signedIn={Boolean(user)} />
      <PortalFooter locale={locale} />
    </main>
  );
}
