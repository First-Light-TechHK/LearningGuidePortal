"use client";

import { forwardRef, useImperativeHandle, useRef, useState, type VideoHTMLAttributes } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize } from 'lucide-react';
import { lessonMessages, type LessonLocale } from '@/messages/lesson-authoring';

// Fullscreen the container so the browser never substitutes its native video toolbar.
export const ControlledVideo = forwardRef<HTMLVideoElement, VideoHTMLAttributes<HTMLVideoElement> & { locale: LessonLocale }>(function ControlledVideo({ locale, onPlay, onPause, onEnded, onTimeUpdate, onLoadedMetadata, onDurationChange, onVolumeChange, ...props }, ref) {
  const media = useRef<HTMLVideoElement>(null), container = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => media.current!);
  const t = lessonMessages(locale);
  const [playing, setPlaying] = useState(false), [time, setTime] = useState(0), [duration, setDuration] = useState(0), [muted, setMuted] = useState(false), [error, setError] = useState('');
  const clock = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
  function updateDuration(video: HTMLVideoElement) {
    setDuration(Number.isFinite(video.duration) ? video.duration : video.seekable.length ? video.seekable.end(video.seekable.length - 1) : 0);
  }
  async function toggle() {
    const video = media.current;
    if (!video) return;
    setError('');
    if (!video.paused) video.pause();
    else try { await video.play(); } catch { setError(t.playbackBlocked); }
  }
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (container.current?.requestFullscreen) await container.current.requestFullscreen();
      else setExpanded(value => !value);
    } catch { setExpanded(value => !value); }
  }
  const [expanded, setExpanded] = useState(false);
  return <div ref={container} className={`la-controlled-video${expanded ? ' la-video-expanded' : ''}`}>
    <video {...props} ref={media} controls={false} playsInline onContextMenu={event => event.preventDefault()}
      onPlay={event => { setPlaying(true); onPlay?.(event); }}
      onPause={event => { setPlaying(false); onPause?.(event); }}
      onEnded={event => { setPlaying(false); onEnded?.(event); }}
      onTimeUpdate={event => { setTime(event.currentTarget.currentTime); updateDuration(event.currentTarget); onTimeUpdate?.(event); }}
      onLoadedMetadata={event => { updateDuration(event.currentTarget); onLoadedMetadata?.(event); }}
      onDurationChange={event => { updateDuration(event.currentTarget); onDurationChange?.(event); }}
      onVolumeChange={event => { setMuted(event.currentTarget.muted); onVolumeChange?.(event); }}/>
    <div className="la-video-controls">
      <button type="button" aria-label={playing ? t.videoPause : t.videoPlay} onClick={() => void toggle()}>{playing ? <Pause size={18}/> : <Play size={18}/>}</button>
      <input type="range" aria-label={t.videoSeek} min={0} max={duration || 0} step={0.1} value={Math.min(time, duration)} disabled={!duration} onChange={event => { if (media.current) media.current.currentTime = Number(event.target.value); }}/>
      <span>{clock(time)} / {clock(duration)}</span>
      <button type="button" aria-label={muted ? t.videoUnmute : t.videoMute} onClick={() => { if (media.current) media.current.muted = !media.current.muted; }}>{muted ? <VolumeX size={18}/> : <Volume2 size={18}/>}</button>
      <button type="button" aria-label={t.videoFullscreen} onClick={() => void fullscreen()}><Maximize size={18}/></button>
    </div>
    {error && <p role="status">{error}</p>}
  </div>;
});
