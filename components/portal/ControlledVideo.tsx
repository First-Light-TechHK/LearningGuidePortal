"use client";

import { forwardRef, useEffect, useLayoutEffect, useImperativeHandle, useRef, useState, type ReactNode, type CSSProperties, type VideoHTMLAttributes } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize, PictureInPicture2, ChevronDown } from 'lucide-react';
import { lessonMessages, type LessonLocale } from '@/messages/lesson-authoring';
import { playbackDuration } from '@/lib/videoLessonCompletion';

// Fullscreen the container so the browser never substitutes its native video toolbar.
export const ControlledVideo = forwardRef<HTMLVideoElement, VideoHTMLAttributes<HTMLVideoElement> & { locale: LessonLocale; fullscreenOverlay?: ReactNode; onFullscreenChange?: (active:boolean)=>void; exitFullscreenRequested?:boolean }>(function ControlledVideo({ locale, fullscreenOverlay, onFullscreenChange, exitFullscreenRequested, onPlay, onPause, onEnded, onTimeUpdate, onLoadedMetadata, onDurationChange, onVolumeChange, onRateChange, onSeeked, onEmptied, ...props }, ref) {
  const media = useRef<HTMLVideoElement>(null), container = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);
  const surfaceAction = useRef(0);
  const [feedback, setFeedback] = useState<{ kind: 'play' | 'pause'; id: number } | null>(null);
  useEffect(() => {
    setFeedback(null); surfaceAction.current += 1;
    return () => { surfaceAction.current += 1; };
  }, [props.src]);
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 700);
    return () => clearTimeout(timer);
  }, [feedback]);
  const [dragging, setDragging] = useState(false);
  const [seekFocused, setSeekFocused] = useState(false);
  const [seekHovered, setSeekHovered] = useState(false);
  useImperativeHandle(ref, () => media.current!);
  const t = lessonMessages(locale);
  const [playing, setPlaying] = useState(false), [time, setTime] = useState(0), [duration, setDuration] = useState(0), [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1), [pipSupported, setPipSupported] = useState(false), [pipActive, setPipActive] = useState(false);
  useEffect(() => {
    const video = media.current;
    if (!video) return;
    setPipSupported(!!document.pictureInPictureEnabled && typeof video.requestPictureInPicture === 'function' && !video.disablePictureInPicture);
    const enter = () => setPipActive(true), leave = () => setPipActive(false);
    video.addEventListener('enterpictureinpicture', enter);
    video.addEventListener('leavepictureinpicture', leave);
    return () => {
      video.removeEventListener('enterpictureinpicture', enter);
      video.removeEventListener('leavepictureinpicture', leave);
      if (document.pictureInPictureElement === video) void document.exitPictureInPicture().catch(() => undefined);
    };
  }, [props.disablePictureInPicture]);
  async function pictureInPicture() {
    const video = media.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement === video) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch { /* Keep playback feedback out of the player. */ }
  }
  const clock = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
  function updateDuration(video: HTMLVideoElement) {
    setDuration(playbackDuration(video));
  }
  function boundedTime(video: HTMLVideoElement) {
    const total = playbackDuration(video);
    return Number.isFinite(video.currentTime) ? Math.min(total, Math.max(0, video.currentTime)) : 0;
  }
  function syncPosition(video: HTMLVideoElement) {
    if (!scrubbing.current && !video.seeking) setTime(boundedTime(video));
  }
  function seekTo(value: number) {
    const video = media.current;
    if (!video) return;
    const total = playbackDuration(video);
    if (!total || !Number.isFinite(value)) return;
    const next = Math.min(total, Math.max(0, value));
    setTime(next);
    // Pointer drags preview locally and make one media seek on release.
    try { if (Math.abs(video.currentTime - next) > .001) video.currentTime = next; }
    catch { setTime(boundedTime(video)); }
  }
  function finishScrub(value: number) {
    if (!scrubbing.current) return;
    scrubbing.current = false; setDragging(false); seekTo(value);
  }
  function cancelScrub() {
    if (!scrubbing.current) return;
    scrubbing.current = false; setDragging(false);
    if (media.current) syncPosition(media.current);
  }
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const video = media.current;
      if (video && !scrubbing.current && !video.seeking) {
        const total = playbackDuration(video);
        const next = Number.isFinite(video.currentTime) ? Math.min(total, Math.max(0, video.currentTime)) : 0;
        setTime(previous => Math.abs(previous - next) >= .02 ? next : previous);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, props.src]);
  const progress = duration > 0 ? Math.min(100, Math.max(0, time / duration * 100)) : 0;
  const preciseClock = (value: number) => {
    const tenths = Math.floor(Math.max(0, value) * 10);
    return `${Math.floor(tenths / 600)}:${((tenths % 600) / 10).toFixed(1).padStart(4, '0')}`;
  };
  async function toggle(showFeedback = false) {
    const video = media.current;
    if (!video) return;
    const action = ++surfaceAction.current;
    if (!video.paused) {
      video.pause();
      if (showFeedback && video.paused) setFeedback({ kind: 'pause', id: action });
    } else {
      // A rejected or policy-blocked play must not flash a successful play icon.
      try { await video.play(); } catch { return; }
      if (showFeedback && action === surfaceAction.current && !video.paused && !video.ended) setFeedback({ kind: 'play', id: action });
    }
  }
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (container.current?.requestFullscreen) await container.current.requestFullscreen();
      else setExpanded(value => !value);
    } catch { setExpanded(value => !value); }
  }
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const update = () => onFullscreenChange?.(expanded || document.fullscreenElement === container.current);
    update();document.addEventListener('fullscreenchange',update);
    return () => document.removeEventListener('fullscreenchange',update);
  }, [expanded,onFullscreenChange]);
  useLayoutEffect(() => { if(exitFullscreenRequested)setExpanded(false); }, [exitFullscreenRequested]);
  return <div ref={container} className={`la-controlled-video${expanded ? ' la-video-expanded' : ''}`} data-playing={playing}>
    <video {...props} ref={media} controls={false} playsInline onContextMenu={event => event.preventDefault()}
      onPlay={event => { setPlaying(true); onPlay?.(event); }}
      onPause={event => { setPlaying(false); syncPosition(event.currentTarget); onPause?.(event); }}
      onEnded={event => { setPlaying(false); syncPosition(event.currentTarget); onEnded?.(event); }}
      onTimeUpdate={event => { syncPosition(event.currentTarget); updateDuration(event.currentTarget); onTimeUpdate?.(event); }}
      onLoadedMetadata={event => { updateDuration(event.currentTarget); syncPosition(event.currentTarget); onLoadedMetadata?.(event); }}
      onDurationChange={event => { updateDuration(event.currentTarget); onDurationChange?.(event); }}
      onSeeked={event => { syncPosition(event.currentTarget); onSeeked?.(event); }}
      onEmptied={event => { surfaceAction.current += 1; setFeedback(null); scrubbing.current = false; setDragging(false); setPlaying(false); setTime(0); setDuration(0); onEmptied?.(event); }}
      onVolumeChange={event => { setMuted(event.currentTarget.muted); onVolumeChange?.(event); }}
      onRateChange={event => { setRate(event.currentTarget.playbackRate); onRateChange?.(event); }}/>
    <button type="button" className="la-video-surface" aria-label={playing ? t.videoSurfacePause : t.videoSurfacePlay} onClick={() => void toggle(true)}>
      {feedback && <span key={feedback.id} className="la-video-action-feedback" data-video-action={feedback.kind} aria-hidden="true">
        {feedback.kind === 'pause' ? <Pause size={36} fill="currentColor"/> : <Play size={36} fill="currentColor"/>}
      </span>}
    </button>
    {fullscreenOverlay && <div className="la-video-fullscreen-exhibit">{fullscreenOverlay}</div>}
    <div className="la-video-controls">
      <button type="button" aria-label={playing ? t.videoPause : t.videoPlay} onClick={() => void toggle()}>{playing ? <Pause size={18}/> : <Play size={18}/>}</button>
      <div className="la-video-seek" data-dragging={dragging} style={{ '--video-progress': `${progress}%` } as CSSProperties}
        onMouseEnter={() => setSeekHovered(true)} onMouseLeave={() => setSeekHovered(false)}>
        {(dragging || seekFocused || seekHovered) && duration > 0 && <output className="la-video-seek-preview" aria-hidden="true" style={{left:`clamp(28px, ${progress}%, calc(100% - 28px))`}}>{preciseClock(time)}</output>}
        <input type="range" aria-label={t.videoSeek} aria-valuetext={`${preciseClock(time)} / ${preciseClock(duration)}`} min={0} max={duration || 0} step={0.01} value={Math.min(time, duration)} disabled={!duration}
          onFocus={() => setSeekFocused(true)}
          onPointerDown={event => { scrubbing.current = true; setDragging(true); event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerUp={event => finishScrub(Number(event.currentTarget.value))}
          onPointerCancel={cancelScrub}
          onLostPointerCapture={event => finishScrub(Number(event.currentTarget.value))}
          onBlur={event => { setSeekFocused(false); finishScrub(Number(event.currentTarget.value)); }}
          onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const step = Math.min(5, duration / 10);
            seekTo(event.key === 'Home' ? 0 : event.key === 'End' ? duration : Number(event.currentTarget.value) + (event.key === 'ArrowLeft' ? -step : step));
          }}
          onChange={event => { const next = Number(event.target.value); if (scrubbing.current) setTime(next); else seekTo(next); }}/>
      </div>
      <span>{clock(time)} / {clock(duration)}</span>
      <button type="button" aria-label={muted ? t.videoUnmute : t.videoMute} onClick={() => { if (media.current) media.current.muted = !media.current.muted; }}>{muted ? <VolumeX size={18}/> : <Volume2 size={18}/>}</button>
      <span className="la-video-speed">
        <span aria-hidden="true">{rate === 1 ? t.videoNormalSpeed : `${rate}×`}</span><ChevronDown size={12} aria-hidden="true" />
        <select aria-label={t.videoSpeed} title={t.videoSpeed} value={rate} onChange={event => { if (media.current) { media.current.playbackRate = Number(event.target.value); setRate(media.current.playbackRate); } }}>
          {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(speed => <option key={speed} value={speed}>{speed === 1 ? t.videoNormalSpeed : `${speed}×`}</option>)}
        </select>
      </span>
      <button type="button" aria-label={pipActive ? t.videoPipExit : t.videoPipEnter} title={!pipSupported ? t.videoPipUnsupported : pipActive ? t.videoPipExit : t.videoPipEnter} aria-pressed={pipActive} disabled={!pipSupported || !duration} onClick={() => void pictureInPicture()}><PictureInPicture2 size={18}/></button>
      <button type="button" aria-label={t.videoFullscreen} onClick={() => void fullscreen()}><Maximize size={18}/></button>
    </div>
  </div>;
});
