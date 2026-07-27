import { useEffect, useState } from 'react';
import { formatSeconds, useAuth } from './state';
import { usePlayer } from './player';

/** Average color of a region of the cover, sampled via canvas. */
function sampleColors(img: HTMLImageElement): string[] {
  const canvas = document.createElement('canvas');
  const size = 48;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return ['#3a2f5c', '#1c4a5e', '#5c2f45'];
  ctx.drawImage(img, 0, 0, size, size);
  const regions: [number, number][] = [
    [0, 0],
    [size / 2, 0],
    [0, size / 2],
    [size / 2, size / 2],
  ];
  const colors: string[] = [];
  for (const [rx, ry] of regions) {
    const data = ctx.getImageData(rx, ry, size / 2, size / 2).data;
    let r = 0,
      g = 0,
      b = 0,
      n = 0;
    for (let i = 0; i < data.length; i += 16) {
      r += data[i]!;
      g += data[i + 1]!;
      b += data[i + 2]!;
      n++;
    }
    // Boost saturation a touch so washed-out covers still glow.
    const boost = (v: number) => Math.min(255, Math.round((v / n) * 1.25));
    colors.push(`rgb(${boost(r)}, ${boost(g)}, ${boost(b)})`);
  }
  return colors;
}

export function FullscreenPlayer({ onClose }: { onClose: () => void }) {
  const { client } = useAuth();
  const { current, playing, positionSec, durationSec, toggle, next, previous } = usePlayer();
  const [colors, setColors] = useState<string[]>(['#3a2f5c', '#1c4a5e', '#5c2f45', '#2f5c3a']);

  const artSrc = current?.artUrl ? client.mediaUrl(current.artUrl) : null;

  useEffect(() => {
    if (!artSrc) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        setColors(sampleColors(img));
      } catch {
        // canvas tainted or decode issue — keep defaults
      }
    };
    img.src = artSrc;
  }, [artSrc]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, toggle]);

  if (!current) return null;
  const progress = durationSec > 0 ? positionSec / durationSec : 0;

  return (
    <div className="fs" onDoubleClick={onClose}>
      <div className="fs-blobs" aria-hidden>
        {colors.map((c, i) => (
          <div key={i} className={`fs-blob fs-blob-${i}`} style={{ background: c }} />
        ))}
      </div>

      <button className="fs-close" onClick={onClose} title="Exit fullscreen (Esc)">
        ✕
      </button>

      <div className="fs-center">
        {artSrc ? (
          <img className={`fs-art${playing ? '' : ' paused'}`} src={artSrc} alt="" />
        ) : (
          <div className="fs-art fs-art-empty">♪</div>
        )}
        <div className="fs-title">{current.title}</div>
        <div className="fs-artist">
          {current.artistName ?? 'Unknown artist'}
          {current.albumTitle ? ` — ${current.albumTitle}` : ''}
        </div>

        <div className="fs-progress">
          <span>{formatSeconds(positionSec)}</span>
          <div className="fs-bar">
            <div className="fs-bar-fill" style={{ width: `${progress * 100}%` }} />
          </div>
          <span>{formatSeconds(durationSec)}</span>
        </div>

        <div className="fs-controls">
          <button onClick={previous}>⏮</button>
          <button className="fs-play" onClick={toggle}>
            {playing ? '❚❚' : '▶'}
          </button>
          <button onClick={next}>⏭</button>
        </div>
      </div>
    </div>
  );
}
