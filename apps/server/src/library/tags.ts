import { and, eq, isNull, sql } from 'drizzle-orm';
import { tracks } from '@baes/db';
import type { Database } from '../db.js';

/**
 * Leak trackers prefix titles with a marker emoji (star = best of, trophy =
 * grail, ...). One leading emoji, possibly built from several code points
 * (variation selectors, ZWJ sequences, skin tones), then the real title.
 */
const LEADING_TAG =
  /^(\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier}|‍\p{Extended_Pictographic}️?)*)\s*(.*)$/u;

const VS16 = '️'; // variation selector: "draw this as an emoji"

/**
 * One spelling per tag: trackers write the star with and without the
 * variation selector interchangeably. Drop selectors, then add one back only
 * to a lone symbol that is text-style by default (scissors, wastebasket),
 * which would otherwise render as a plain monochrome glyph.
 */
export function normalizeTag(emoji: string): string {
  const bare = emoji.replaceAll(VS16, '');
  return [...bare].length === 1 && !/\p{Emoji_Presentation}/u.test(bare) ? bare + VS16 : bare;
}

/** Built-in names for the common tracker markers; the owner can rename them. */
export const DEFAULT_TAG_LABELS: Record<string, string> = {
  [normalizeTag('\u{1F3C6}')]: 'Grail', // trophy
  [normalizeTag('⭐')]: 'Best of', // star
  [normalizeTag('✨')]: 'Special', // sparkles
  [normalizeTag('✂')]: 'Snippet', // scissors
  [normalizeTag('\u{1F5D1}')]: 'Worst of', // wastebasket
};

/** Splits a leading marker emoji off a title. A title that is only an emoji keeps it. */
export function splitTag(title: string): { title: string; tag: string | null } {
  const m = LEADING_TAG.exec(title.trim());
  if (!m || !m[2]!.trim()) return { title, tag: null };
  return { title: m[2]!.trim(), tag: normalizeTag(m[1]!) };
}

/**
 * Moves leading tags out of titles already in the library. Idempotent:
 * once split, a title no longer starts with an emoji. Returns rows updated.
 */
export async function backfillTags(db: Database): Promise<number> {
  const rows = await db
    .select({ id: tracks.id, title: tracks.title })
    .from(tracks)
    .where(and(isNull(tracks.tag), isNull(tracks.rawTitle)));
  let updated = 0;
  for (const row of rows) {
    const { title, tag } = splitTag(row.title);
    if (!tag) continue;
    await db
      .update(tracks)
      .set({ title, tag, rawTitle: row.title, updatedSeq: sql`nextval('change_seq')` })
      .where(eq(tracks.id, row.id));
    updated++;
  }
  return updated;
}
