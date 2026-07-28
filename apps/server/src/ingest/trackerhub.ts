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
  eraName: string | null;
  qualities: string[];
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
  quality?: unknown;
  links?: unknown;
}

interface ArtistGridEra {
  name?: unknown;
  tracks?: unknown;
}

function artistGridTrackLinks(track: ArtistGridTrack): string[] {
  if (!Array.isArray(track.links)) return [];
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
    if (importable) return [importable];
  }
  return [];
}

function artistGridEraLinks(payload: unknown, source: TrackerSheet): string[] {
  if (!payload || typeof payload !== 'object' || !source.eraName) return [];
  const data = payload as { eras?: unknown; tracks?: unknown };
  const wantedEra = normalizedLabel(source.eraName);
  let tracks: ArtistGridTrack[] = [];
  let eraNames: string[] = [];

  if (Array.isArray(data.eras)) {
    const eras = data.eras.filter(
      (era): era is ArtistGridEra => Boolean(era) && typeof era === 'object',
    );
    eraNames = eras.flatMap((era) => (typeof era.name === 'string' ? [era.name] : []));
    tracks = eras
      .filter((era) => typeof era.name === 'string' && normalizedLabel(era.name) === wantedEra)
      .flatMap((era) => (Array.isArray(era.tracks) ? (era.tracks as ArtistGridTrack[]) : []));
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

  return uniqueLinks(tracks.flatMap(artistGridTrackLinks));
}

function isSignInResponse(res: Response, body: string): boolean {
  return (
    res.url.includes('accounts.google.com') ||
    /<title>\s*Google Sheets:\s*Sign-in|to continue to Google Sheets/i.test(body)
  );
}

/** Fetches public TrackerHub rows and extracts their source-media links. */
export async function trackerhubMediaUrls(input: string): Promise<string[]> {
  const source = trackerSheet(input);
  if (!source) throw new Error('Not a supported TrackerHub or Google Sheets URL');

  if (source.artistGrid && source.eraName) {
    const response = await fetch(artistGridApiUrl(source), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(30 * 1000),
    });
    if (!response.ok) {
      throw new Error(`ArtistGrid could not load this tracker (${response.status})`);
    }
    const links = artistGridEraLinks(await response.json(), source);
    if (links.length === 0) {
      throw new Error(`No playable media links were found in “${source.eraName}”`);
    }
    return links;
  }

  let gid = source.gid;
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
    if (links.length > 0) return links;
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
  return links;
}
