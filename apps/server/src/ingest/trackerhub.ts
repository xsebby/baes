const TRACKERHUB_HOSTS = new Set(['artistgrid.cx', 'www.artistgrid.cx']);
const URL_PATTERN = /https?:\/\/[^\s"'<>\\]+/gi;
const MAX_TRACKER_LINKS = 50;
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

function normalizedTabName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
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
