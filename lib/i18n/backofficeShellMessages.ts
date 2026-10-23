import en from "@/messages/backoffice-shell/en-GB.json";
import zh from "@/messages/backoffice-shell/zh-CN.json";

export type BackofficeShellMessages = typeof en;

export function getBackofficeShellMessages(locale: "en-GB" | "zh-CN"): BackofficeShellMessages { return locale === "zh-CN" ? zh : en; }
