"use client";
import type { CourseLearningMode } from "@/contracts/course-learning-mode";
import { preferredLessonContentId } from "@/lib/courseLearningMode";

import Link from "next/link";
import { getMessages } from "@/lib/i18n/messages";
import { useEffect, useRef, useState } from "react";
import { ExplorationDialog } from "./ExplorationDialog";
import { TutorChat } from "./TutorChat";
import { LessonCompletionBar } from "./LessonCompletionBar";
import { TextLessonCompletion } from "./TextLessonCompletion";
import type { VideoPlaybackProgress } from "@/contracts/video-progress";
import { canPromptVideoCompletion, videoCompletionPercent } from "@/lib/videoLessonCompletion";
import { LessonContentPlayer } from "./LessonContentPlayer";
import type { LessonContent } from "@/contracts/lesson-content";
import type { ExplorationLesson } from "@/contracts/exploration";

export function LearningRoom({ locale, courseId, lesson, initialCompleted, completedContentIds, copy, fallbackImageUrl = null, preferredMode = null, lessonNumber = "01", nextHref = null, explorationLessons }: { locale: "en-GB" | "zh-CN"; courseId: string; lesson: { id: string; title: string; body: string; durationMinutes: number; contents?: LessonContent[] }; initialCompleted: boolean; completedContentIds?: string[]; copy: { study: string; minutes: string; you: string; completeLesson: string; completed: string; tutor: string; lecture: string; socratic: string; send: string; askTutor: string; newChat: string; closeTutor: string; askTutorPlaceholder: string }; fallbackImageUrl?: string | null; preferredMode?: CourseLearningMode | null; lessonNumber?: string; nextHref?: string | null; explorationLessons?: ExplorationLesson[] }) {
  const roomRef = useRef<HTMLDivElement>(null);
  const [exploreOpen, setExploreOpen] = useState(false);
  function openExploration() { roomRef.current?.querySelectorAll<HTMLMediaElement>("video,audio").forEach(media => media.pause()); setExploreOpen(true); }
  const activeContents = (lesson.contents || []).filter(content => content.active !== false);
  const [contentId, setContentId] = useState(preferredLessonContentId(activeContents, preferredMode));
  const [videoProgress, setVideoProgress] = useState<VideoPlaybackProgress | null>(null);
  const [ended, setEnded] = useState<{ contentId: string; request: number } | null>(null);
  const selected = activeContents.find(content => content.id === contentId) || activeContents[0];
  useEffect(() => { void fetch("/api/study/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ courseId, lessonId: lesson.id, event: "open", seconds: 0, clientEventId: `open_${courseId}_${lesson.id}` }) }); }, [courseId, lesson.id]);
  return <div ref={roomRef} className="learning-room"><article className="lesson-content"><p className="portal-eyebrow">{copy.study}</p><header style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:16,flexWrap:"wrap"}}><h1>{lesson.title}</h1>{selected?.type === "video" && <LessonCompletionBar key={`${lesson.id}:${selected.id}`} contentId={selected.id} visible={canPromptVideoCompletion(true, selected.id, videoProgress)} endedRequest={ended?.contentId === selected.id ? ended.request : 0} locale={locale} courseId={courseId} lessonId={lesson.id} lessonNumber={lessonNumber} nextHref={nextHref} percentage={videoCompletionPercent(videoProgress) || 0} seconds={Math.floor(videoProgress?.currentTime || 0)} initialCompleted={completedContentIds ? completedContentIds.includes(selected.id) : initialCompleted}/>}</header><p className="lesson-duration">{lesson.durationMinutes} {copy.minutes}</p>{lesson.contents !== undefined ? <LessonContentPlayer selectedContentId={contentId} onContentChange={setContentId} onVideoProgress={setVideoProgress} onVideoEnded={progress => setEnded(previous => ({ contentId: progress.contentId, request: (previous?.request || 0) + 1 }))} key={lesson.id} contents={lesson.contents} locale={locale} fallbackImageUrl={fallbackImageUrl}/> : <div className="lesson-body">{lesson.body.split("\n\n").map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>}<TextLessonCompletion key={lesson.id} visible={selected?.type !== "video"} locale={locale} courseId={courseId} lessonId={lesson.id} lessonNumber={lessonNumber} lessonTitle={lesson.title} nextHref={nextHref}/></article><aside><Link className="portal-button portal-button-secondary" href={`/${locale}/portal/courses/${encodeURIComponent(courseId)}/understanding?lessonId=${encodeURIComponent(lesson.id)}`}>{getMessages(locale).previewVideoDesign.understanding}</Link><button type="button" className="portal-button portal-button-secondary" onClick={openExploration}>{getMessages(locale).previewVideoDesign.explore}</button><TutorChat locale={locale} courseId={courseId} lessonId={lesson.id} copy={copy} /></aside>{exploreOpen && <ExplorationDialog lessons={explorationLessons??[{number:lessonNumber,title:lesson.title,unlocked:true}]} locale={locale} courseId={courseId} lessonNumber={lessonNumber} onClose={() => setExploreOpen(false)} onAskTutor={() => { setExploreOpen(false); roomRef.current?.querySelector<HTMLTextAreaElement>("aside textarea")?.focus(); }}/> }</div>;
}
