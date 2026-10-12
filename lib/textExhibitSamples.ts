import type { TextExhibit } from "@/contracts/text-exhibit";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";

/** User-authorised display samples only; no writes to published course content. */
export function textExhibitSamples(locale: Locale): TextExhibit[] {
  const copy = getMessages(locale).textExhibit;
  return [
    { id: "sample-exhibit-image", title: copy.imageTitle, type: "image", url: "/portal/exh2.jpg", triggerTime: 0 },
    { id: "sample-exhibit-video", title: copy.videoTitle, type: "video", url: "/portal/text-exhibits/flowers.webm", triggerTime: 0 },
    { id: "sample-exhibit-model", title: copy.modelTitle, type: "model3d", url: "/portal/text-exhibits/vase.obj", triggerTime: 0 },
  ];
}
