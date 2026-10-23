"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import type { LessonNode } from "@/contracts/lesson-content";
import { EXHIBIT_ZOOM, type ExhibitViewerControls } from "@/contracts/exhibit-viewer";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { PortalDialog } from "./PortalDialog";
import { ControlledVideo } from "./ControlledVideo";
import { safeMediaUrl } from "./CourseMediaPreview";
import styles from "./exhibit-dialog.module.css";

const CourseModelPreview = dynamic(() => import("./CourseModelPreview").then(module => module.CourseModelPreview), { ssr:false });

export function ExhibitDialog({ node, locale, onClose }: { node: LessonNode; locale: Locale; onClose: () => void }) {
  const messages = getMessages(locale), copy = messages.exhibitDialog, src = safeMediaUrl(node.url);
  const stage = useRef<HTMLDivElement>(null), video = useRef<HTMLVideoElement>(null), model = useRef<ExhibitViewerControls>(null);
  const [zoom, setZoom] = useState(1), [position, setPosition] = useState({x:0,y:0}), [ready, setReady] = useState(false), [failed, setFailed] = useState(!src);
  const drag = useRef<{id:number;x:number;y:number;originX:number;originY:number}|null>(null);
  const isModel = node.type === "model3d", isImage = node.type === "image";
  function changeZoom(factor:number) {
    if (isModel) model.current?.zoom(factor);
    else setZoom(value => Math.min(EXHIBIT_ZOOM.max, Math.max(EXHIBIT_ZOOM.min, value * factor)));
  }
  useEffect(() => {
    const element = stage.current;
    if (!element || isModel) return;
    const wheel = (event:WheelEvent) => { event.preventDefault(); if (!ready || failed) return; setZoom(value => Math.min(EXHIBIT_ZOOM.max, Math.max(EXHIBIT_ZOOM.min, value * (event.deltaY < 0 ? EXHIBIT_ZOOM.step : 1 / EXHIBIT_ZOOM.step)))); };
    element.addEventListener("wheel",wheel,{passive:false});
    return () => element.removeEventListener("wheel",wheel);
  }, [isModel, ready, failed]);
  function reset() { drag.current=null; if (isModel) model.current?.reset(); else {setZoom(1);setPosition({x:0,y:0});} }
  const hint = isModel ? copy.modelHint : isImage ? copy.imageHint : copy.videoHint;
  return <PortalDialog className={styles.dialog} labelledBy="exhibit-title" onClose={onClose}>
    <header className={styles.header}><span className={styles.kind}>{messages.videoExhibit.types[node.type]}</span><h2 id="exhibit-title">{node.title || messages.videoExhibit.untitled}</h2><button type="button" className={styles.close} aria-label={copy.close} onClick={onClose}><Image src="/portal/exhibit-dialog/close-light.svg" width={20} height={20} alt=""/></button></header>
    <div className={styles.body}><div ref={stage} className={`${styles.stage} ${isImage ? styles.imageStage : ""}`} tabIndex={isImage ? 0 : undefined} aria-label={hint}
      onPointerDown={event => { if(!isImage || !ready || failed || event.button !== 0 || (event.target as Element).closest("button"))return; event.currentTarget.setPointerCapture(event.pointerId);drag.current={id:event.pointerId,x:event.clientX,y:event.clientY,originX:position.x,originY:position.y}; }}
      onPointerMove={event => { const start=drag.current;if(start?.id===event.pointerId)setPosition({x:start.originX+event.clientX-start.x,y:start.originY+event.clientY-start.y}); }}
      onPointerUp={event=>{if(drag.current?.id===event.pointerId){drag.current=null;event.currentTarget.releasePointerCapture(event.pointerId);}}} onPointerCancel={()=>{drag.current=null;}}
      onKeyDown={event=>{if(!isImage || event.target!==event.currentTarget || !ready)return;const steps:Record<string,{x:number;y:number}>={ArrowLeft:{x:-20,y:0},ArrowRight:{x:20,y:0},ArrowUp:{x:0,y:-20},ArrowDown:{x:0,y:20}};const step=steps[event.key];if(step){event.preventDefault();setPosition(value=>({x:value.x+step.x,y:value.y+step.y}));}}}>
      {!failed && isImage && <Image className={styles.resourceImage} src={src} alt={node.title} unoptimized fill draggable={false} style={{transform:`translate(${position.x}px,${position.y}px) scale(${zoom})`}} onLoad={()=>setReady(true)} onError={()=>setFailed(true)}/>}
      {!failed && node.type === "video" && <div className={`${styles.video} la`}><ControlledVideo ref={video} locale={locale} src={src} preload="metadata" style={{transform:`scale(${zoom})`}} onLoadedMetadata={()=>setReady(true)} onError={()=>setFailed(true)}/></div>}
      {!failed && isModel && <CourseModelPreview url={src} title={node.title} locale={locale} exhibit controlsRef={model} onZoomChange={setZoom} onReadyChange={setReady}/>}
      {failed && <p className={styles.status} role="alert">{copy.failed}</p>}
      {!failed && !ready && !isModel && <p className={styles.status} role="status">{copy.loading}</p>}
      {isModel && <Image className={styles.floorShadow} src="/portal/exhibit-dialog/floor-shadow.svg" width={292} height={72} alt=""/>}
      <div className={styles.controls} role="group" aria-label={copy.controls}><button type="button" aria-label={copy.zoomOut} disabled={!ready || failed || zoom <= EXHIBIT_ZOOM.min + .001} onClick={()=>changeZoom(1/EXHIBIT_ZOOM.step)}><Image src="/portal/exhibit-dialog/zoom-out.svg" width={18} height={18} alt=""/></button><output aria-label={copy.zoom}>{Math.round(zoom*100)}%</output><button type="button" aria-label={copy.zoomIn} disabled={!ready || failed || zoom >= EXHIBIT_ZOOM.max - .001} onClick={()=>changeZoom(EXHIBIT_ZOOM.step)}><Image src="/portal/exhibit-dialog/zoom-in.svg" width={18} height={18} alt=""/></button><span className={styles.controlDivider} aria-hidden="true"/><button type="button" disabled={!ready || failed} onClick={reset}>{copy.reset}</button></div>
    </div><aside className={styles.about}><h3>{copy.about}</h3><p>{node.description || (isModel ? copy.modelDescription : isImage ? copy.imageDescription : copy.videoDescription)}</p><div className={styles.asideLine} aria-hidden="true"/><div className={styles.source}><h4>{copy.source}</h4><p>{node.source || copy.collection}</p></div></aside></div>
  </PortalDialog>;
}
