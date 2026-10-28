"use client";

import { useEffect, useState } from "react";
import type { LessonNode } from "@/contracts/lesson-content";
import type { Locale } from "@/lib/i18n/config";
import { textExhibitPositions } from "@/lib/textExhibitLayout";
import { textExhibitSamples } from "@/lib/textExhibitSamples";
import { SafeLessonHtml, sanitiseLessonHtml } from "./CourseMediaPreview";
import { VideoExhibitBar } from "./VideoExhibitBar";
import { ExhibitDialog } from "./ExhibitDialog";
import styles from "./text-exhibit-content.module.css";

const NO_NODES: LessonNode[] = [];

export function TextExhibitContent({ html, locale, exhibitMode, nodes = NO_NODES }: { html: string; locale: Locale; exhibitMode?: "authored" | "samples"; nodes?: LessonNode[] }) {
  const [blocks, setBlocks] = useState<{ html: string; exhibit?: LessonNode }[]>([]), [active, setActive] = useState<LessonNode | null>(null);
  const [preparedHtml, setPreparedHtml] = useState<string | null>(null);
  useEffect(() => {
    setActive(null);
    const document = new DOMParser().parseFromString(sanitiseLessonHtml(html), "text/html");
    // Inline exhibit references are reading text, including legacy imported markers.
    document.body.querySelectorAll(".instance-node, [data-instance-type], [data-node-id]").forEach(marker => {
      marker.replaceWith(...Array.from(marker.childNodes));
    });
    const elements = Array.from(document.body.childNodes);
    const count = document.body.querySelectorAll(":scope > p").length;
    const authored = new Map(nodes.filter(node => node.active !== false && ["image", "video", "model3d"].includes(node.type)).map(node => [node.id, node]));
    const inserted = new Set<string>();
    const samples = exhibitMode === "authored" || document.body.querySelector('[data-exhibit-card]') ? [] : textExhibitSamples(locale), positions = textExhibitPositions(count, samples.length);
    const result: { html: string; exhibit?: LessonNode }[] = [];
    let paragraph = 0;
    elements.forEach(element => {
      if (element instanceof Element && element.tagName === "DIV" && element.hasAttribute("data-exhibit-card")) {
        const id = element.getAttribute("data-exhibit-card")!, exhibit = authored.get(id);
        if (exhibit && !inserted.has(id)) { result.push({ html: "", exhibit }); inserted.add(id); }
        return;
      }
      const block = element instanceof Element ? element.outerHTML : element.textContent?.trim() ? `<p>${element.textContent.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>` : "";
      if (block) result.push({ html: block });
      if (element instanceof Element && element.tagName === "P") {
        paragraph++;
        positions.forEach((position, index) => { if (position === paragraph) result.push({ html:"", exhibit:samples[index] }); });
      }
    });
    if (!count) samples.forEach(exhibit => result.push({html:"",exhibit}));
    setBlocks(result);
    setPreparedHtml(html);
  }, [html, locale, exhibitMode, nodes]);
  return <div className={styles.content} data-text-ready={preparedHtml === html ? "true" : undefined}>{blocks.map((block, index) => block.exhibit ? <VideoExhibitBar key={block.exhibit.id} node={block.exhibit} locale={locale} variant="text" onView={() => setActive(block.exhibit!)}/> : <SafeLessonHtml key={index} html={block.html}/>)}{active && <ExhibitDialog key={active.id} node={active} locale={locale} onClose={() => setActive(null)}/>}</div>;
}
