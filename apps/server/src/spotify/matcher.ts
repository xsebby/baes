/**
 * Matching Spotify tracks to local library files (PRD §5.5).
 * Tier 1: ISRC exact. Tier 2: normalized artist+title with duration within 2s.
 */

export interface LocalCandidate {
  id: string;
  title: string;
  artistName: string | null;
  durationMs: number;
  isrc: string | null;
}

export interface ExternalMeta {
  title: string;
  artist: string;
  durationMs: number | null;
  isrc: string | null;
}

export interface MatchResult {
  trackId: string;
  confidence: number;
  tier: 'isrc' | 'exact';
}

/** Lowercase, strip punctuation/feat-clauses/bracketed suffixes for comparison. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(feat[^)]*\)|\[feat[^\]]*\]|feat\.? .+$/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function matchTrack(
  external: ExternalMeta,
  candidates: LocalCandidate[],
): MatchResult | null {
  if (external.isrc) {
    const isrcHit = candidates.find(
      (c) => c.isrc && c.isrc.toUpperCase() === external.isrc!.toUpperCase(),
    );
    if (isrcHit) return { trackId: isrcHit.id, confidence: 1, tier: 'isrc' };
  }

  const extTitle = normalize(external.title);
  const extArtist = normalize(external.artist);
  if (!extTitle) return null;

  for (const c of candidates) {
    if (normalize(c.title) !== extTitle) continue;
    if (extArtist && normalize(c.artistName ?? '') !== extArtist) continue;
    if (
      external.durationMs != null &&
      c.durationMs > 0 &&
      Math.abs(c.durationMs - external.durationMs) > 2000
    ) {
      continue;
    }
    return { trackId: c.id, confidence: 0.9, tier: 'exact' };
  }
  return null;
}
