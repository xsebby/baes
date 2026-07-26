import { createHmac } from 'node:crypto';
import { safeEqual } from '../auth/tokens.js';

/**
 * Short-lived HMAC-signed URLs for media bytes (PRD §5.2). The stream/art
 * endpoints validate these instead of session auth so native players and
 * <Image> can fetch them directly; a leaked URL dies at `exp`.
 */
export function signMedia(secret: string, kind: 'stream' | 'art', id: string, exp: number): string {
  return createHmac('sha256', secret).update(`${kind}:${id}:${exp}`).digest('base64url');
}

export function verifyMedia(
  secret: string,
  kind: 'stream' | 'art',
  id: string,
  exp: number,
  sig: string,
): boolean {
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  return safeEqual(signMedia(secret, kind, id, exp), sig);
}

export function mediaPath(kind: 'stream' | 'art', id: string, secret: string, ttlSeconds: number) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = signMedia(secret, kind, id, exp);
  const base = kind === 'stream' ? `/api/stream/${id}` : `/api/art/${id}`;
  return { url: `${base}?exp=${exp}&sig=${sig}`, expiresAt: new Date(exp * 1000).toISOString() };
}
