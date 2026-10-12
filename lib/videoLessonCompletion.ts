import type { VideoPlaybackProgress } from "@/contracts/video-progress";

export function playbackDuration(media: Pick<HTMLMediaElement, "duration" | "seekable">): number {
  if (Number.isFinite(media.duration) && media.duration > 0) return media.duration;
  const end = media.seekable.length ? media.seekable.end(media.seekable.length - 1) : 0;
  return Number.isFinite(end) && end > 0 ? end : 0;
}

export function videoCompletionPercent(progress: VideoPlaybackProgress | null): number | null {
  if (!progress || !Number.isFinite(progress.duration) || progress.duration <= 0 || !Number.isFinite(progress.currentTime) || progress.currentTime < 0) return null;
  return Math.min(100, progress.currentTime / progress.duration * 100);
}

export function canPromptVideoCompletion(entitled: boolean, selectedContentId: string | undefined, progress: VideoPlaybackProgress | null) {
  const percent = videoCompletionPercent(progress);
  return entitled && selectedContentId === progress?.contentId && percent !== null && percent >= 98;
}
