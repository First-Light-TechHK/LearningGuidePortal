/**
 * Notification P0 transactional email layout (design §6, Figma B03).
 *
 * One fixed layout for all three P0 emails: brand/logo header, the template
 * body, an optional single button, then the footer with the reason the learner
 * receives the message and the privacy link. Only the body, button label and
 * button link come from the editable template; the shell never does.
 *
 * Plain, inline-styled table markup: the layout must survive Outlook and the
 * free-mailbox SMTP path this deployment uses. No external stylesheet and no
 * remote font.
 */

export type EmailLayoutLanguage = "en" | "zh";

export type EmailLayoutInput = {
  language: EmailLayoutLanguage;
  /** The inbox subject; also the document title. */
  subject: string;
  /** Rendered email body (template copy with variables resolved). */
  body: string;
  buttonText?: string | null;
  buttonUrl?: string | null;
  /** Footer sentence: why this learner receives the email. */
  footerReason: string;
  /** Absolute Portal origin, used for the privacy link. */
  appUrl: string;
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function paragraphs(body: string) {
  return body
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `<p style="margin:0 0 16px 0;">${escapeHtml(part).replace(/\n/g, "<br />")}</p>`)
    .join("");
}

function privacyUrl(appUrl: string, language: EmailLayoutLanguage) {
  const locale = language === "zh" ? "zh-CN" : "en-GB";
  const base = appUrl.replace(/\/+$/, "");
  return `${base}/${locale}/privacy-policy`;
}

/**
 * Build the fixed-layout HTML and its plain-text alternative.
 *
 * `data-email-layout="notification-p0"` marks the shell for the regression
 * test that every P0 email keeps the same layout.
 */
export function buildNotificationEmail(input: EmailLayoutInput): { html: string; text: string } {
  const language = input.language;
  const subject = input.subject.trim();
  const buttonText = input.buttonText?.trim() || "";
  const buttonUrl = input.buttonUrl?.trim() || "";
  const showButton = Boolean(buttonText && buttonUrl);
  const privacy = privacyUrl(input.appUrl, language);
  const privacyLabel = language === "zh" ? "隐私政策" : "Privacy policy";
  const footerReason = input.footerReason.trim();

  const bodyHtml = paragraphs(input.body);
  const buttonHtml = showButton
    ? `<a href="${escapeHtml(buttonUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;padding:12px 26px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;line-height:20px;">${escapeHtml(buttonText)}</a>`
    : "";

  const html = `<!doctype html>
<html lang="${language === "zh" ? "zh-CN" : "en-GB"}" data-email-layout="notification-p0">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f8;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f6f8;padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;">
<tr><td style="padding:28px 32px 0 32px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="40" height="40" align="center" valign="middle" style="width:40px;height:40px;background:#2563eb;border-radius:10px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;">LG</td>
<td style="padding-left:12px;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:700;color:#111827;">Learning Guide</td>
</tr></table>
</td></tr>
<tr><td style="padding:20px 32px 8px 32px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:#1f2937;">
${bodyHtml}
</td></tr>
${showButton ? `<tr><td style="padding:8px 32px 28px 32px;">${buttonHtml}</td></tr>` : `<tr><td style="padding:0 32px 8px 32px;"></td></tr>`}
<tr><td style="padding:20px 32px 28px 32px;border-top:1px solid #e5e7eb;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#6b7280;">
<p style="margin:0 0 8px 0;">${escapeHtml(footerReason)}</p>
<p style="margin:0;">Learning Guide Ltd &middot; <a href="${escapeHtml(privacy)}" style="color:#6b7280;">${privacyLabel}</a></p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const textParts = [subject, "", input.body.trim()];
  if (showButton) textParts.push("", `${buttonText}: ${buttonUrl}`);
  textParts.push("", footerReason, `Learning Guide Ltd · ${privacyLabel}: ${privacy}`);
  return { html, text: textParts.join("\n") };
}
