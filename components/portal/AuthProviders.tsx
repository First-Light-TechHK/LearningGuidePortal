import Image from "next/image";

export function AuthProviders({ locale, returnTo, googleEnabled, wechatEnabled, copy }: {
  locale: "en-GB" | "zh-CN"; returnTo: string; googleEnabled?: boolean; wechatEnabled?: boolean;
  copy: { or: string; google: string; wechat: string };
}) {
  if (!googleEnabled && !wechatEnabled) return null;
  return <div className="auth-provider-options auth-provider-icons"><div className="auth-provider-divider"><span>{copy.or}</span></div><div className="auth-provider-links">
    {googleEnabled ? <a className="auth-provider-icon auth-provider-google" href={`/api/auth/google?locale=${locale}&returnTo=${encodeURIComponent(returnTo)}`} aria-label={copy.google} title={copy.google}><Image src="/portal/figma-google.png" width={16} height={16} alt="" /></a> : null}
    {wechatEnabled ? <a className="auth-provider-icon" href={`/api/auth/wechat?locale=${locale}&returnTo=${encodeURIComponent(returnTo)}`} aria-label={copy.wechat} title={copy.wechat}><Image src="/portal/figma-wechat.png" width={32} height={32} alt="" /></a> : null}
  </div></div>;
}
