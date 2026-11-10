"use client";

import { Tooltip } from "antd";
import Image from "next/image";

export function AuthProviders({ locale, returnTo, googleEnabled, wechatEnabled, copy, disabled = false, consentRequired, wechatFirst = false, variant = "icons" }: {
  locale: "en-GB" | "zh-CN"; returnTo: string; googleEnabled?: boolean; wechatEnabled?: boolean;
  copy: { or: string; google: string; wechat: string; socialSignUpWith?: string }; disabled?: boolean; consentRequired?: { message: string; onAttempt: () => void }; wechatFirst?: boolean; variant?: "icons" | "buttons" | "signin";
}) {
  if (!googleEnabled && !wechatEnabled) return null;
  const buttonVariant = variant !== "icons";
  const signInVariant = variant === "signin";
  function provider(name: "google" | "wechat") {
    const label = copy[name];
    const className = `auth-provider-icon${name === "google" ? " auth-provider-google" : ""}${buttonVariant ? " auth-provider-button" : ""}`;
    const content = <><Image src={buttonVariant ? `/portal/figma-signin-${name}.svg` : `/portal/figma-${name}.png`} width={buttonVariant ? 22 : name === "google" ? 16 : 32} height={buttonVariant ? 22 : name === "google" ? 16 : 32} alt="" />{buttonVariant ? <span>{label}</span> : null}</>;
    if (!disabled && consentRequired) return <Tooltip title={consentRequired.message} trigger={["hover", "focus"]} destroyOnHidden>
      <button type="button" className={className} aria-label={label} onClick={consentRequired.onAttempt}>{content}</button>
    </Tooltip>;
    return <a className={className} href={disabled ? undefined : `/api/auth/${name}?locale=${locale}&returnTo=${encodeURIComponent(returnTo)}`} role={disabled ? "link" : undefined} aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : undefined} aria-label={label} title={label}>{content}</a>;
  }
  const google = googleEnabled ? provider("google") : null;
  const wechat = wechatEnabled ? provider("wechat") : null;
  return <div className={`auth-provider-options ${buttonVariant ? "auth-provider-buttons" : "auth-provider-icons"}${signInVariant ? " auth-provider-signin" : ""}`}><div className="auth-provider-divider"><span>{buttonVariant && !signInVariant ? copy.socialSignUpWith || copy.or : copy.or}</span></div><div className="auth-provider-links">
    {wechatFirst ? <>{wechat}{google}</> : <>{google}{wechat}</>}
  </div></div>;
}
