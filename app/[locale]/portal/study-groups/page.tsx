import { PortalFooter } from "@/components/portal/PortalFooter";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { currentProductUser } from "@/services/productAuth";
import { getMessages } from "@/lib/i18n/messages";
import { localeFrom } from "@/lib/i18n/config";

export default async function StudyGroupsPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFrom((await params).locale);
  const messages = getMessages(locale);
  const user = await currentProductUser();
  const copy = messages.studyGroupsPage;

  return (
    <main className="portal-page portal-study-groups-page">
      <PortalHeader locale={locale} active="study-groups" signedIn={Boolean(user)} displayName={user?.nickname} avatarUrl={user?.avatarPath ? "/api/my-learning/avatar" : undefined} />
      <section className="portal-section portal-section-first study-groups-page" aria-labelledby="study-groups-title">
        <p className="portal-eyebrow">{messages.portal.navigation.studyGroups}</p>
        <h1 id="study-groups-title">{copy.title}</h1>
        <p className="portal-lead">{copy.description}</p>
        <div className="study-groups-status" role="status">
          <strong>{copy.statusTitle}</strong>
          <p>{copy.statusDescription}</p>
        </div>
        <div className="study-groups-options">
          {copy.options.map((option) => (
            <article className="study-groups-option" key={option.title}>
              <h2>{option.title}</h2>
              <p>{option.description}</p>
            </article>
          ))}
        </div>
      </section>
      <PortalFooter locale={locale} />
    </main>
  );
}
