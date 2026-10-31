"use client";

import { forwardRef, useEffect, useLayoutEffect, useImperativeHandle, useId, useRef, useState, type ReactNode, type CSSProperties, type VideoHTMLAttributes } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize, PictureInPicture2, ChevronDown } from 'lucide-react';
import { lessonMessages, type LessonLocale } from '@/messages/lesson-authoring';
import { playbackDuration } from '@/lib/videoLessonCompletion';

// Fullscreen the container so the browser never substitutes its native video toolbar.
export const ControlledVideo = forwardRef<HTMLVideoElement, VideoHTMLAttributes<HTMLVideoElement> & { locale: LessonLocale; fullscreenOverlay?: ReactNode; dialogOverlay?: ReactNode; hideFullscreen?: boolean; onFullscreenChange?: (active:boolean)=>void }>(function ControlledVideo({ locale, fullscreenOverlay, dialogOverlay, hideFullscreen = false, onFullscreenChange, onPlay, onPause, onEnded, onTimeUpdate, onLoadedMetadata, onDurationChange, onVolumeChange, onRateChange, onSeeked, onEmptied, ...props }, ref) {
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
  const volumeControl = useRef<HTMLDivElement>(null), volumeButton = useRef<HTMLButtonElement>(null);
  const volumeId = useId();
  useImperativeHandle(ref, () => media.current!);
  const t = lessonMessages(locale);
  const [playing, setPlaying] = useState(false), [time, setTime] = useState(0), [duration, setDuration] = useState(0), [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1), [pipSupported, setPipSupported] = useState(false), [pipActive, setPipActive] = useState(false);
  const [volume, setVolume] = useState(100), [volumeOpen, setVolumeOpen] = useState(false);
  useEffect(() => {
    if (!volumeOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !volumeControl.current?.contains(event.target)) setVolumeOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [volumeOpen]);
  function updateVolume(video: HTMLVideoElement) {
    setMuted(video.muted || video.volume === 0);
    setVolume(video.muted ? 0 : Math.round(video.volume * 100));
  }
  useLayoutEffect(() => { if (media.current) updateVolume(media.current); }, [props.muted]);
  useEffect(() => {
    const control = volumeControl.current;
    if (!control) return;
    const adjustVolume = (event: WheelEvent) => {
      const video = media.current;
      if (!video || event.ctrlKey || !Number.isFinite(event.deltaY) || event.deltaY === 0) return;
      // Read native media state so rapid wheel events and external mute changes stay in sync.
      event.preventDefault();
      const current = video.muted ? 0 : Math.round(video.volume * 100);
      const next = Math.min(100, Math.max(0, current + (event.deltaY < 0 ? 5 : -5)));
      video.volume = next / 100;
      video.muted = next === 0;
      updateVolume(video);
    };
    // React's wheel listener is passive; this local listener also prevents page scrolling.
    control.addEventListener('wheel', adjustVolume, { passive: false });
    return () => control.removeEventListener('wheel', adjustVolume);
  }, []);
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
  return <div ref={container} className={`la-controlled-video${expanded ? ' la-video-expanded' : ''}`} data-playing={playing}>
    <video {...props} ref={media} controls={false} playsInline onContextMenu={event => event.preventDefault()}
      onPlay={event => { setPlaying(true); onPlay?.(event); }}
      onPause={event => { setPlaying(false); syncPosition(event.currentTarget); onPause?.(event); }}
      onEnded={event => { setPlaying(false); syncPosition(event.currentTarget); onEnded?.(event); }}
      onTimeUpdate={event => { syncPosition(event.currentTarget); updateDuration(event.currentTarget); onTimeUpdate?.(event); }}
      onLoadedMetadata={event => { updateDuration(event.currentTarget); syncPosition(event.currentTarget); updateVolume(event.currentTarget); onLoadedMetadata?.(event); }}
      onDurationChange={event => { updateDuration(event.currentTarget); onDurationChange?.(event); }}
      onSeeked={event => { syncPosition(event.currentTarget); onSeeked?.(event); }}
      onEmptied={event => { surfaceAction.current += 1; setFeedback(null); scrubbing.current = false; setDragging(false); setPlaying(false); setTime(0); setDuration(0); onEmptied?.(event); }}
      onVolumeChange={event => { updateVolume(event.currentTarget); onVolumeChange?.(event); }}
      onRateChange={event => { setRate(event.currentTarget.playbackRate); onRateChange?.(event); }}/>
    <button type="button" className="la-video-surface" aria-label={playing ? t.videoSurfacePause : t.videoSurfacePlay} onClick={() => void toggle(true)}>
      {feedback && <span key={feedback.id} className="la-video-action-feedback" data-video-action={feedback.kind} aria-hidden="true">
        {feedback.kind === 'pause' ? <Pause size={36} fill="currentColor"/> : <Play size={36} fill="currentColor"/>}
      </span>}
    </button>
    {fullscreenOverlay && <div className="la-video-fullscreen-exhibit">{fullscreenOverlay}</div>}
    {dialogOverlay}
    <div className="la-video-controls">
      <button type="button" aria-label={playing ? t.videoPause : t.videoPlay} onClick={() => void toggle()}>{playing ? <Pause size={18}/> : <Play size={18}/>}</button>
      <div className="la-video-seek-container" data-dragging={dragging} style={{ '--video-progress': `${progress}%` } as CSSProperties}
        onMouseEnter={() => setSeekHovered(true)} onMouseLeave={() => setSeekHovered(false)}>
        {(dragging || seekFocused || seekHovered) && duration > 0 && <output className="la-video-seek-preview" aria-hidden="true" style={{left:`clamp(28px, ${progress}%, calc(100% - 28px))`}}>{preciseClock(time)}</output>}
        <input className="la-video-seek" type="range" aria-label={t.videoSeek} aria-valuetext={`${preciseClock(time)} / ${preciseClock(duration)}`} min={0} max={duration || 0} step={0.01} value={Math.min(time, duration)} disabled={!duration}
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
      <div ref={volumeControl} className="la-video-volume"
        onPointerEnter={event => { if (event.pointerType === 'mouse' && window.matchMedia('(hover: hover) and (pointer: fine)').matches) setVolumeOpen(true); }}
        onPointerLeave={event => {
          if (event.pointerType === 'mouse' && !event.currentTarget.querySelector('input')?.hasPointerCapture(event.pointerId) && !event.currentTarget.querySelector(':focus-visible')) setVolumeOpen(false);
        }}
        onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setVolumeOpen(false); }}
        onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setVolumeOpen(false); volumeButton.current?.focus(); } }}>
        <button ref={volumeButton} type="button" aria-label={t.videoVolume} title={t.videoVolume} aria-expanded={volumeOpen} aria-controls={volumeOpen ? volumeId : undefined}
          onClick={event => setVolumeOpen(value => event.detail === 0 || !window.matchMedia('(hover: hover) and (pointer: fine)').matches ? !value : true)}>{muted ? <VolumeX size={18}/> : <Volume2 size={18}/>}</button>
        {volumeOpen && <div id={volumeId} className="la-video-volume-panel">
          <span aria-hidden="true">{volume}</span>
          <input className="la-video-volume-range" type="range" aria-label={t.videoVolume} aria-orientation="vertical" min={0} max={100} step={1} value={volume} aria-valuetext={`${volume}%`}
            onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)}
            onPointerUp={event => {
              if (event.pointerType === 'mouse' && !volumeControl.current?.contains(document.elementFromPoint(event.clientX, event.clientY))) setVolumeOpen(false);
            }}
            onPointerCancel={() => setVolumeOpen(false)}
            onChange={event => {
              const video = media.current;
              if (!video) return;
              const nextVolume = Number(event.currentTarget.value);
              video.volume = nextVolume / 100;
              video.muted = nextVolume === 0;
              updateVolume(video);
            }}/>
        </div>}
      </div>
      <span className="la-video-speed">
        <span aria-hidden="true">{rate === 1 ? t.videoNormalSpeed : `${rate}×`}</span><ChevronDown size={12} aria-hidden="true" />
        <select aria-label={t.videoSpeed} title={t.videoSpeed} value={rate} onChange={event => { if (media.current) { media.current.playbackRate = Number(event.target.value); setRate(media.current.playbackRate); } }}>
          {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(speed => <option key={speed} value={speed}>{speed === 1 ? t.videoNormalSpeed : `${speed}×`}</option>)}
        </select>
      </span>
      <button type="button" aria-label={pipActive ? t.videoPipExit : t.videoPipEnter} title={!pipSupported ? t.videoPipUnsupported : pipActive ? t.videoPipExit : t.videoPipEnter} aria-pressed={pipActive} disabled={!pipSupported || !duration} onClick={() => void pictureInPicture()}><PictureInPicture2 size={18}/></button>
      {!hideFullscreen && <button type="button" aria-label={t.videoFullscreen} onClick={() => void fullscreen()}><Maximize size={18}/></button>}
    </div>
  </div>;
});
