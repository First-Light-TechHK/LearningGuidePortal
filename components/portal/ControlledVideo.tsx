"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type VideoHTMLAttributes } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize, PictureInPicture2 } from 'lucide-react';
import { lessonMessages, type LessonLocale } from '@/messages/lesson-authoring';

// Fullscreen the container so the browser never substitutes its native video toolbar.
export const ControlledVideo = forwardRef<HTMLVideoElement, VideoHTMLAttributes<HTMLVideoElement> & { locale: LessonLocale }>(function ControlledVideo({ locale, onPlay, onPause, onEnded, onTimeUpdate, onLoadedMetadata, onDurationChange, onVolumeChange, onRateChange, ...props }, ref) {
  const media = useRef<HTMLVideoElement>(null), container = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => media.current!);
  const t = lessonMessages(locale);
  const [playing, setPlaying] = useState(false), [time, setTime] = useState(0), [duration, setDuration] = useState(0), [muted, setMuted] = useState(false), [error, setError] = useState('');
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
    setError('');
    try {
      if (document.pictureInPictureElement === video) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch { setError(t.videoPipFailed); }
  }
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
      onVolumeChange={event => { setMuted(event.currentTarget.muted); onVolumeChange?.(event); }}
      onRateChange={event => { setRate(event.currentTarget.playbackRate); onRateChange?.(event); }}/>
    {pipActive && <div className="la-video-pip-status" role="status">{t.videoPipActive}</div>}
    <div className="la-video-controls">
      <button type="button" aria-label={playing ? t.videoPause : t.videoPlay} onClick={() => void toggle()}>{playing ? <Pause size={18}/> : <Play size={18}/>}</button>
      <input type="range" aria-label={t.videoSeek} min={0} max={duration || 0} step={0.1} value={Math.min(time, duration)} disabled={!duration} onChange={event => { if (media.current) media.current.currentTime = Number(event.target.value); }}/>
      <span>{clock(time)} / {clock(duration)}</span>
      <button type="button" aria-label={muted ? t.videoUnmute : t.videoMute} onClick={() => { if (media.current) media.current.muted = !media.current.muted; }}>{muted ? <VolumeX size={18}/> : <Volume2 size={18}/>}</button>
      <select aria-label={t.videoSpeed} title={t.videoSpeed} value={rate} onChange={event => { if (media.current) { media.current.playbackRate = Number(event.target.value); setRate(media.current.playbackRate); } }}>
        {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(speed => <option key={speed} value={speed}>{speed === 1 ? t.videoNormalSpeed : `${speed}×`}</option>)}
      </select>
      <button type="button" aria-label={pipActive ? t.videoPipExit : t.videoPipEnter} title={!pipSupported ? t.videoPipUnsupported : pipActive ? t.videoPipExit : t.videoPipEnter} aria-pressed={pipActive} disabled={!pipSupported || !duration} onClick={() => void pictureInPicture()}><PictureInPicture2 size={18}/></button>
      <button type="button" aria-label={t.videoFullscreen} onClick={() => void fullscreen()}><Maximize size={18}/></button>
    </div>
    {error && <p role="status">{error}</p>}
  </div>;
});
