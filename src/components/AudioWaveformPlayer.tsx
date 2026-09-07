import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { UiIcon } from './UiIcon';

type WaveformData = { duration: number; peaks: number[] };
const waveformCache = new Map<string, Promise<WaveformData>>();

function timeLabel(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

async function decodeWaveform(src: string, bars = 96): Promise<WaveformData> {
  const cached = waveformCache.get(src);
  if (cached) return cached;
  const pending = (async () => {
    const response = await fetch(src);
    if (!response.ok) throw new Error('音频读取失败');
    const buffer = await response.arrayBuffer();
    const context = new AudioContext();
    try {
      const audio = await context.decodeAudioData(buffer.slice(0));
      const channels = Array.from({ length: audio.numberOfChannels }, (_, index) => audio.getChannelData(index));
      const block = Math.max(1, Math.floor(audio.length / bars));
      const peaks = Array.from({ length: bars }, (_, bar) => {
        const start = bar * block;
        const end = Math.min(audio.length, start + block);
        let peak = 0;
        for (let sample = start; sample < end; sample += Math.max(1, Math.floor(block / 48))) {
          for (const channel of channels) peak = Math.max(peak, Math.abs(channel[sample] || 0));
        }
        return peak;
      });
      const maximum = Math.max(.01, ...peaks);
      return { duration: audio.duration, peaks: peaks.map((peak) => Math.max(.05, peak / maximum)) };
    } finally {
      void context.close();
    }
  })();
  waveformCache.set(src, pending);
  pending.catch(() => waveformCache.delete(src));
  return pending;
}

export function AudioWaveformPlayer({ src, className = '', onDuration }: { src: string; className?: string; onDuration?: (duration: number) => void }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const waveformRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | undefined>(undefined);
  const onDurationRef = useRef(onDuration);
  const [waveform, setWaveform] = useState<WaveformData>();
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => { onDurationRef.current = onDuration; }, [onDuration]);

  useEffect(() => {
    let active = true;
    setWaveform(undefined);
    setCurrentTime(0);
    void decodeWaveform(src).then((decoded) => {
      if (!active) return;
      setWaveform(decoded);
      setDuration(decoded.duration);
      onDurationRef.current?.(decoded.duration);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [src]);

  useEffect(() => {
    const tick = () => {
      const audio = audioRef.current;
      if (!audio) return;
      setCurrentTime(audio.currentTime);
      if (!audio.paused) animationRef.current = window.requestAnimationFrame(tick);
    };
    if (playing) animationRef.current = window.requestAnimationFrame(tick);
    return () => { if (animationRef.current) window.cancelAnimationFrame(animationRef.current); };
  }, [playing]);

  const seek = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    const target = waveformRef.current;
    if (!audio || !target || !duration) return;
    const rect = target.getBoundingClientRect();
    const next = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))) * duration;
    audio.currentTime = next;
    setCurrentTime(next);
  }, [duration]);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) await audio.play();
    else audio.pause();
  };

  const progress = duration > 0 ? Math.max(0, Math.min(1, currentTime / duration)) : 0;
  const bars = waveform?.peaks || Array.from({ length: 96 }, (_, index) => .16 + ((index * 17) % 11) / 30);
  return <div className={`audio-waveform-player nodrag nowheel ${className}`.trim()}>
    <audio ref={audioRef} preload="metadata" src={src} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setCurrentTime(duration); }} onLoadedMetadata={(event) => {
      const next = Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0;
      if (next > 0) { setDuration(next); onDurationRef.current?.(next); }
    }} />
    <button type="button" className="audio-waveform-play" aria-label={playing ? '暂停音频' : '播放音频'} onClick={toggle}><UiIcon name={playing ? 'pause' : 'play'} /></button>
    <div ref={waveformRef} className="audio-waveform-track" role="slider" tabIndex={0} aria-label="音频播放位置" aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(currentTime)} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); seek(event); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) seek(event); }} onKeyDown={(event) => {
      const audio = audioRef.current;
      if (!audio) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const next = Math.max(0, Math.min(duration, audio.currentTime + (event.key === 'ArrowRight' ? 2 : -2)));
      audio.currentTime = next;
      setCurrentTime(next);
    }}>
      <div className="audio-waveform-bars" aria-hidden="true">{bars.map((height, index) => <i key={index} className={index / bars.length <= progress ? 'is-played' : undefined} style={{ height: `${Math.round(height * 100)}%` }} />)}</div>
      <span className="audio-waveform-cursor" style={{ left: `${progress * 100}%` }} aria-hidden="true" />
    </div>
    <span className="audio-waveform-time">{timeLabel(currentTime)} / {timeLabel(duration)}</span>
  </div>;
}
