import Image from "next/image";

export function AuthProviders({ locale, returnTo, googleEnabled, wechatEnabled, copy, wechatFirst = false, variant = "icons" }: {
  locale: "en-GB" | "zh-CN"; returnTo: string; googleEnabled?: boolean; wechatEnabled?: boolean;
  copy: { or: string; google: string; wechat: string; socialSignUpWith?: string }; wechatFirst?: boolean; variant?: "icons" | "buttons" | "signin";
}) {
  if (!googleEnabled && !wechatEnabled) return null;
  const buttonVariant = variant !== "icons";
  const signInVariant = variant === "signin";
  const google = googleEnabled ? <a className={`auth-provider-icon auth-provider-google${buttonVariant ? " auth-provider-button" : ""}`} href={`/api/auth/google?locale=${locale}&returnTo=${encodeURIComponent(returnTo)}`} aria-label={copy.google} title={copy.google}><Image src={buttonVariant ? "/portal/figma-signin-google.svg" : "/portal/figma-google.png"} width={buttonVariant ? 22 : 16} height={buttonVariant ? 22 : 16} alt="" />{buttonVariant ? <span>{copy.google}</span> : null}</a> : null;
  const wechat = wechatEnabled ? <a className={`auth-provider-icon${buttonVariant ? " auth-provider-button" : ""}`} href={`/api/auth/wechat?locale=${locale}&returnTo=${encodeURIComponent(returnTo)}`} aria-label={copy.wechat} title={copy.wechat}><Image src={buttonVariant ? "/portal/figma-signin-wechat.svg" : "/portal/figma-wechat.png"} width={buttonVariant ? 22 : 32} height={buttonVariant ? 22 : 32} alt="" />{buttonVariant ? <span>{copy.wechat}</span> : null}</a> : null;
  return <div className={`auth-provider-options ${buttonVariant ? "auth-provider-buttons" : "auth-provider-icons"}${signInVariant ? " auth-provider-signin" : ""}`}><div className="auth-provider-divider"><span>{buttonVariant && !signInVariant ? copy.socialSignUpWith || copy.or : copy.or}</span></div><div className="auth-provider-links">
    {wechatFirst ? <>{wechat}{google}</> : <>{google}{wechat}</>}
  </div></div>;
}
