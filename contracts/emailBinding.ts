export type EmailBindingRequest = { email: string; locale?: "en-GB" | "zh-CN"; returnTo?: string };
export type EmailBindingConfirmation = { token: string; returnTo?: string; locale?: "en-GB" | "zh-CN" };
