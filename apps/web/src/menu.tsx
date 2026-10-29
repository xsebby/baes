import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ShareKind, ShareLink } from '@baes/core';
import { useAuth } from './state';

// ---- context menu (⋯ button or right-click) ----

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

/** A small menu at (x, y), kept inside the viewport. Closes on outside click, Esc, scroll. */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      top: Math.max(8, y + height > window.innerHeight - 8 ? y - height : y),
    });
  }, [x, y]);

  useEffect(() => {
    const down = (e: MouseEvent | TouchEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', down);
    document.addEventListener('touchstart', down);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('touchstart', down);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  // Portaled to <body>: an animated (transformed) ancestor would otherwise
  // re-anchor `position: fixed` and clip the menu.
  return createPortal(
    <div
      ref={ref}
      className="ctx-menu"
      role="menu"
      style={pos}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          role="menuitem"
          className={item.danger ? 'danger' : undefined}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

// ---- share dialog ----

const EXPIRY: { label: string; days: number | null }[] = [
  { label: '1 day', days: 1 },
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: 'Never', days: null },
];

export interface ShareTarget {
  kind: ShareKind;
  id: string;
  title: string;
}

export function ShareModal({ target, onClose }: { target: ShareTarget; onClose: () => void }) {
  const { client } = useAuth();
  const [days, setDays] = useState<number | null>(7);
  const [allowDownload, setAllowDownload] = useState(true);
  const [link, setLink] = useState<ShareLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Older servers return a path when PUBLIC_URL is unset.
  const url = link ? new URL(link.url, window.location.origin).toString() : '';

  async function create() {
    setBusy(true);
    setError(null);
    try {
      setLink(
        await client.createShare({
          kind: target.kind,
          targetId: target.id,
          allowDownload,
          expiresInDays: days,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the link');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      // Only the URL, so chat apps unfurl it into one preview.
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Copy failed. Select the link and copy it.');
    }
  }

  // React events still bubble from a portal to its React parents (a track row
  // would start playing), so stop them at the backdrop.
  return createPortal(
    <div
      className="modal-backdrop"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div className="modal share-modal" onClick={(e) => e.stopPropagation()}>
        <h3>
          Share <span className="muted">“{target.title}”</span>
        </h3>
        {!link ? (
          <>
            <div className="share-field">
              <span className="share-label">Link expires after</span>
              <div className="seg">
                {EXPIRY.map((o) => (
                  <button
                    key={o.label}
                    className={days === o.days ? 'on' : undefined}
                    onClick={() => setDays(o.days)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="share-check">
              <input
                type="checkbox"
                checked={allowDownload}
                onChange={(e) => setAllowDownload(e.target.checked)}
              />
              Let people download {target.kind === 'track' ? 'the song' : 'the songs'}
            </label>
            <p className="muted small">
              Anyone with the link can listen, no account needed. You can revoke it in Admin →
              Shared links.
            </p>
            {error && <p className="share-error">{error}</p>}
            <div className="modal-actions">
              <button className="iconbtn" onClick={onClose}>
                Cancel
              </button>
              <button className="primary" disabled={busy} onClick={create}>
                {busy ? 'Creating…' : 'Create link'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="share-url">
              <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
              <button className="primary" onClick={copy}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="muted small">
              {link.expiresAt
                ? `Expires ${new Date(link.expiresAt).toLocaleDateString()}`
                : 'Never expires'}
              {' · '}
              {link.allowDownload ? 'downloads on' : 'downloads off'}
            </p>
            {error && <p className="share-error">{error}</p>}
            <div className="modal-actions">
              {typeof navigator.share === 'function' && (
                <button
                  className="iconbtn"
                  onClick={() => void navigator.share({ url }).catch(() => {})}
                >
                  More…
                </button>
              )}
              <button className="iconbtn" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
