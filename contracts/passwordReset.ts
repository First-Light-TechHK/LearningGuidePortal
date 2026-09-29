export type PasswordResetRequest = { email: string; locale?: "en-GB" | "zh-CN"; returnTo?: string };
export type PasswordResetResult = { accepted: true; retryAfter: number; resetUrl: string | null };
