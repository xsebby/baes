import { describe, expect, it } from 'vitest';
import { matchTrack, normalize } from '../src/spotify/matcher.js';

const candidates = [
  { id: 'a', title: 'Midnight Drive', artistName: 'Sebby', durationMs: 183000, isrc: null },
  { id: 'b', title: 'Cold Front (v2)', artistName: 'Sebby', durationMs: 201000, isrc: null },
  { id: 'c', title: 'Anthem', artistName: 'Other Guy', durationMs: 240000, isrc: 'USABC2400001' },
];

describe('normalize', () => {
  it('strips feat clauses, brackets, punctuation, case', () => {
    expect(normalize('Midnight Drive (feat. Someone)')).toBe('midnight drive');
    expect(normalize('COLD FRONT [v2]')).toBe('cold front');
    expect(normalize("What's Up?!")).toBe('what s up');
  });
});

describe('matchTrack', () => {
  it('tier 1: matches by ISRC regardless of title', () => {
    const m = matchTrack(
      { title: 'Different Name', artist: 'X', durationMs: 999, isrc: 'usabc2400001' },
      candidates,
    );
    expect(m).toEqual({ trackId: 'c', confidence: 1, tier: 'isrc' });
  });

  it('tier 2: normalized title+artist within duration tolerance', () => {
    const m = matchTrack(
      { title: 'Midnight Drive (feat. Guest)', artist: 'SEBBY', durationMs: 184500, isrc: null },
      candidates,
    );
    expect(m?.trackId).toBe('a');
    expect(m?.tier).toBe('exact');
  });

  it('rejects duration differences over 2s', () => {
    const m = matchTrack(
      { title: 'Midnight Drive', artist: 'Sebby', durationMs: 190000, isrc: null },
      candidates,
    );
    expect(m).toBeNull();
  });

  it('rejects artist mismatches', () => {
    const m = matchTrack(
      { title: 'Midnight Drive', artist: 'Impostor', durationMs: 183000, isrc: null },
      candidates,
    );
    expect(m).toBeNull();
  });

  it('bracketed version suffixes still match', () => {
    const m = matchTrack(
      { title: 'Cold Front', artist: 'Sebby', durationMs: 200500, isrc: null },
      candidates,
    );
    expect(m?.trackId).toBe('b');
  });
});
