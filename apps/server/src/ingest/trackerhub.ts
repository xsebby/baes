const TRACKERHUB_HOSTS = new Set(['artistgrid.cx', 'www.artistgrid.cx']);
const URL_PATTERN = /https?:\/\/[^\s"'<>\\]+/gi;
const MAX_TRACKER_LINKS = 250;
const MEDIA_HOSTS = new Set([
  'bandcamp.com',
  'catbox.moe',
  'dbree.org',
  'drive.google.com',
  'files.catbox.moe',
  'gofile.io',
  'krakenfiles.com',
  'mega.nz',
  'pillowcase.su',
  'pillows.su',
  'pixeldrain.com',
  'soundcloud.com',
  'voca.ro',
  'vocaroo.com',
  'youtube.com',
  'youtu.be',
]);
const AUDIO_EXTENSION = /\.(?:aac|aif|aiff|flac|m4a|mp3|ogg|opus|wav)(?:$|[?#])/i;

interface TrackerSheet {
  id: string;
  gid: string | null;
  tabName: string | null;
  artistGrid: boolean;
  artistName: string | null;
  eraName: string | null;
  qualities: string[];
}

export interface TrackerImportMetadata {
  title: string;
  artist: string | null;
  album: string | null;
  year: number | null;
  coverUrl: string | null;
  quality?: string | null;
}

export interface TrackerImportItem {
  url: string;
  metadata?: TrackerImportMetadata;
}

function listParams(url: URL, name: string): string[] {
  return url.searchParams
    .getAll(name)
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);
}

function trackerSheet(input: string): TrackerSheet | null {
  try {
    const url = new URL(input);
    const google =
      url.hostname === 'docs.google.com'
        ? /^\/spreadsheets(?:\/u\/\d+)?\/d\/([A-Za-z0-9_-]{20,})/.exec(url.pathname)?.[1]
        : null;
    const artistGridMatch = TRACKERHUB_HOSTS.has(url.hostname.toLowerCase())
      ? /^\/sh\/([A-Za-z0-9_-]{20,})(?:\/([^/?#]+))?\/?/.exec(url.pathname)
      : null;
    const artistGrid = artistGridMatch?.[1];
    const id = google ?? artistGrid;
    return id
      ? {
          id,
          gid: url.searchParams.get('gid'),
          tabName: artistGrid ? (artistGridMatch?.[2] ?? null) : null,
          artistGrid: Boolean(artistGrid),
          artistName: artistGrid ? url.searchParams.get('artist')?.trim() || null : null,
          eraName: artistGrid ? url.searchParams.get('era')?.trim() || null : null,
          qualities: artistGrid
            ? [...listParams(url, 'quality'), ...listParams(url, 'qualities')]
            : [],
        }
      : null;
  } catch {
    return null;
  }
}

function csvUrl(source: TrackerSheet, gid = source.gid): string {
  const url = new URL(`https://docs.google.com/spreadsheets/d/${source.id}/export`);
  url.searchParams.set('format', 'csv');
  if (gid) url.searchParams.set('gid', gid);
  return url.toString();
}

/** Returns the public CSV endpoint for a TrackerHub Google Sheet or ArtistGrid share link. */
export function trackerhubCsvUrl(input: string): string | null {
  const source = trackerSheet(input);
  return source ? csvUrl(source) : null;
}

function trackerhubShellUrl(source: TrackerSheet): string {
  return `https://docs.google.com/spreadsheets/d/${source.id}/htmlview`;
}

function trackerhubHtmlUrl(source: TrackerSheet, gid = source.gid): string {
  const url = new URL(`https://docs.google.com/spreadsheets/d/${source.id}/htmlview/sheet`);
  url.searchParams.set('headers', 'true');
  if (gid) url.searchParams.set('gid', gid);
  return url.toString();
}

function artistGridApiUrl(source: TrackerSheet): string {
  const base = `https://trackerapi.artistgrid.cx/sh/${encodeURIComponent(source.id)}`;
  return source.tabName ? `${base}/tab/${encodeURIComponent(source.tabName)}` : `${base}/`;
}

async function artistGridPayload(source: TrackerSheet): Promise<unknown> {
  const response = await fetch(artistGridApiUrl(source), {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(30 * 1000),
  });
  if (!response.ok) {
    throw new Error(`ArtistGrid could not load this tracker (${response.status})`);
  }
  return response.json();
}

function artistGridTabGid(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || !('tab' in payload)) return null;
  const tab = payload.tab;
  if (!tab || typeof tab !== 'object' || !('gid' in tab)) return null;
  return typeof tab.gid === 'string' || typeof tab.gid === 'number' ? String(tab.gid) : null;
}

function normalizedTabName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizedLabel(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

function gidForTab(shell: string, tabName: string): string | null {
  const wanted = normalizedTabName(tabName);
  for (const match of shell.matchAll(/items\.push\(\{name:\s*"([^"]+)"[^}]*?gid:\s*"(\d+)"/g)) {
    if (normalizedTabName(match[1]!) === wanted) return match[2]!;
  }
  return null;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&#x2F;/gi, '/');
}

function importableUrl(value: string): string | null {
  try {
    const url = new URL(decodeHtml(value).replace(/[),.;]+$/, ''));
    const hostname = url.hostname.toLowerCase();
    if ((hostname === 'google.com' || hostname === 'www.google.com') && url.pathname === '/url') {
      const target = url.searchParams.get('q') ?? url.searchParams.get('url');
      return target ? importableUrl(target) : null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const supportedHost = [...MEDIA_HOSTS].some(
      (host) => hostname === host || hostname.endsWith(`.${host}`),
    );
    return supportedHost || AUDIO_EXTENSION.test(url.pathname) ? url.toString() : null;
  } catch {
    return null;
  }
}

function uniqueLinks(links: string[]): string[] {
  return [...new Set(links.flatMap((link) => importableUrl(link) ?? []))].slice(
    0,
    MAX_TRACKER_LINKS,
  );
}

function csvLinks(csv: string): string[] {
  return uniqueLinks(csv.match(URL_PATTERN) ?? []);
}

function htmlLinks(html: string): string[] {
  const links = [...html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)].map(
    (match) => match[1]!,
  );
  return uniqueLinks(links);
}

interface ArtistGridTrack {
  era?: unknown;
  file_date?: unknown;
  leak_date?: unknown;
  name?: unknown;
  quality?: unknown;
  links?: unknown;
}

interface ArtistGridEra {
  cover_art?: unknown;
  name?: unknown;
  tracks?: unknown;
}

function artistGridTrackUrl(track: ArtistGridTrack): string | null {
  if (!Array.isArray(track.links)) return null;
  for (const link of track.links) {
    const value =
      typeof link === 'string'
        ? link
        : link && typeof link === 'object' && 'url' in link && typeof link.url === 'string'
          ? link.url
          : null;
    const importable = value ? importableUrl(value) : null;
    // ArtistGrid treats a row's links as fallbacks for the same track. Import
    // the first source Baes supports rather than downloading duplicate copies.
    if (importable) return importable;
  }
  return null;
}

function artistGridTrackTitle(track: ArtistGridTrack): string {
  if (typeof track.name === 'string') return track.name.trim();
  if (track.name && typeof track.name === 'object') {
    if ('title' in track.name && typeof track.name.title === 'string') {
      return track.name.title.trim();
    }
    if ('raw' in track.name && typeof track.name.raw === 'string') {
      return track.name.raw.split('\n', 1)[0]!.trim();
    }
  }
  return 'Unknown track';
}

function artistGridTrackYear(track: ArtistGridTrack): number | null {
  for (const value of [track.file_date, track.leak_date]) {
    if (typeof value !== 'string') continue;
    const match = /\b(?:19|20)\d{2}\b/.exec(value);
    if (match) return Number(match[0]);
  }
  return null;
}

function httpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function uniqueItems(items: TrackerImportItem[]): TrackerImportItem[] {
  const seen = new Set<string>();
  return items
    .filter((item) => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    })
    .slice(0, MAX_TRACKER_LINKS);
}

function artistGridEraItems(payload: unknown, source: TrackerSheet): TrackerImportItem[] {
  if (!payload || typeof payload !== 'object' || !source.eraName) return [];
  const data = payload as { eras?: unknown; name?: unknown; tracks?: unknown };
  const wantedEra = normalizedLabel(source.eraName);
  let tracks: ArtistGridTrack[] = [];
  let eraNames: string[] = [];
  let coverUrl: string | null = null;

  if (Array.isArray(data.eras)) {
    const eras = data.eras.filter(
      (era): era is ArtistGridEra => Boolean(era) && typeof era === 'object',
    );
    eraNames = eras.flatMap((era) => (typeof era.name === 'string' ? [era.name] : []));
    tracks = eras
      .filter((era) => typeof era.name === 'string' && normalizedLabel(era.name) === wantedEra)
      .flatMap((era) => {
        coverUrl ??= httpUrl(era.cover_art);
        return Array.isArray(era.tracks) ? (era.tracks as ArtistGridTrack[]) : [];
      });
  } else if (Array.isArray(data.tracks)) {
    const flatTracks = data.tracks as ArtistGridTrack[];
    eraNames = [
      ...new Set(flatTracks.flatMap((track) => (typeof track.era === 'string' ? [track.era] : []))),
    ];
    tracks = flatTracks.filter(
      (track) => typeof track.era === 'string' && normalizedLabel(track.era) === wantedEra,
    );
  }

  if (tracks.length === 0) {
    const examples = eraNames.slice(0, 12).join(', ');
    throw new Error(
      `The “${source.eraName}” ArtistGrid era was not found${
        examples ? `. Available eras include: ${examples}` : ''
      }`,
    );
  }

  if (source.qualities.length > 0) {
    const wantedQualities = source.qualities.map(normalizedLabel);
    const availableQualities = [
      ...new Set(
        tracks.flatMap((track) => (typeof track.quality === 'string' ? [track.quality] : [])),
      ),
    ];
    tracks = tracks.filter((track) => {
      const qualityLabel = track.quality;
      return (
        typeof qualityLabel === 'string' &&
        wantedQualities.some((quality) => normalizedLabel(qualityLabel).includes(quality))
      );
    });
    if (tracks.length === 0) {
      throw new Error(
        `No tracks in “${source.eraName}” matched ${source.qualities.join(
          ' or ',
        )}. Available qualities: ${availableQualities.join(', ') || 'none listed'}`,
      );
    }
  }

  const trackerArtist =
    typeof data.name === 'string' ? data.name.replace(/\s+Tracker.*$/i, '').trim() : null;
  const artist = source.artistName ?? trackerArtist;
  return uniqueItems(
    tracks.flatMap((track) => {
      const url = artistGridTrackUrl(track);
      return url
        ? [
            {
              url,
              metadata: {
                title: artistGridTrackTitle(track),
                artist,
                album: source.eraName,
                year: artistGridTrackYear(track),
                coverUrl,
                quality: typeof track.quality === 'string' ? track.quality.trim() || null : null,
              },
            },
          ]
        : [];
    }),
  );
}

function isSignInResponse(res: Response, body: string): boolean {
  return (
    res.url.includes('accounts.google.com') ||
    /<title>\s*Google Sheets:\s*Sign-in|to continue to Google Sheets/i.test(body)
  );
}

/** Fetches public TrackerHub rows with optional ArtistGrid metadata. */
export async function trackerhubImportItems(input: string): Promise<TrackerImportItem[]> {
  const source = trackerSheet(input);
  if (!source) throw new Error('Not a supported TrackerHub or Google Sheets URL');

  if (source.artistGrid && source.eraName) {
    const items = artistGridEraItems(await artistGridPayload(source), source);
    if (items.length === 0) {
      throw new Error(`No playable media links were found in “${source.eraName}”`);
    }
    return items;
  }

  let gid = source.gid;
  if (!gid && source.artistGrid && source.tabName) {
    try {
      gid = artistGridTabGid(await artistGridPayload(source));
    } catch {
      // The public Google Sheet remains a useful fallback if ArtistGrid's API
      // is temporarily unavailable.
    }
  }
  if (!gid && source.tabName) {
    const shellResponse = await fetch(trackerhubShellUrl(source), {
      headers: { accept: 'text/html' },
      signal: AbortSignal.timeout(30 * 1000),
    });
    const shell = await shellResponse.text();
    if (!shellResponse.ok || isSignInResponse(shellResponse, shell)) {
      throw new Error(
        'This TrackerHub sheet is not publicly viewable. Enable link sharing and try again.',
      );
    }
    gid = gidForTab(shell, source.tabName);
    if (!gid) throw new Error(`The “${source.tabName}” TrackerHub tab was not found`);
  }

  const csvResponse = await fetch(csvUrl(source, gid), {
    headers: { accept: 'text/csv, text/plain;q=0.9' },
    signal: AbortSignal.timeout(30 * 1000),
  });
  const csv = await csvResponse.text();
  if (
    csvResponse.ok &&
    !isSignInResponse(csvResponse, csv) &&
    !/^\s*<!doctype html|^\s*<html/i.test(csv)
  ) {
    const links = csvLinks(csv);
    if (links.length > 0) return links.map((url) => ({ url }));
  }

  const htmlResponse = await fetch(trackerhubHtmlUrl(source, gid), {
    headers: { accept: 'text/html' },
    signal: AbortSignal.timeout(30 * 1000),
  });
  const html = await htmlResponse.text();
  if (
    !htmlResponse.ok ||
    isSignInResponse(htmlResponse, html) ||
    (!csvResponse.ok && !htmlResponse.ok)
  ) {
    throw new Error(
      'This TrackerHub sheet is not publicly exportable. Share it as “Anyone with the link” or use a public CSV link.',
    );
  }

  const links = htmlLinks(html);
  if (links.length === 0) throw new Error('No media links were found in this TrackerHub sheet');
  return links.map((url) => ({ url }));
}

/** Fetches only the media URLs for callers that do not need tracker metadata. */
export async function trackerhubMediaUrls(input: string): Promise<string[]> {
  return (await trackerhubImportItems(input)).map((item) => item.url);
}
