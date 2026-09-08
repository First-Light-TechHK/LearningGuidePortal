export function SocialSignInCard({ locale, linked, copy }: { locale: "en-GB" | "zh-CN"; linked: boolean; copy: { signInMethodsTitle: string; googleConnected: string; googleConnectedHint: string; googleConnect: string; googleConnectHint: string } }) {
  const returnTo = encodeURIComponent(`/${locale}/account/my-learning/settings`);
  return (
    <div className="settings-signin-methods">
      <h2>{copy.signInMethodsTitle}</h2>
      <div className="settings-signin-row">
        <div><strong>Google</strong><p className="settings-hint">{linked ? copy.googleConnectedHint : copy.googleConnectHint}</p></div>
        {linked ? <span className="settings-linked-badge">{copy.googleConnected}</span> : <a className="portal-button portal-button-secondary" href={`/api/auth/google?locale=${locale}&returnTo=${returnTo}`}>{copy.googleConnect}</a>}
      </div>
    </div>
  );
}
