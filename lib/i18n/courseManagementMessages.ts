import en from "@/messages/course-management/en-GB.json";
import zh from "@/messages/course-management/zh-CN.json";

export function getCourseManagementMessages(locale: "en-GB" | "zh-CN") { return locale === "zh-CN" ? zh : en; }
