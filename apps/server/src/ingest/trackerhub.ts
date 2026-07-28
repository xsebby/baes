const TRACKERHUB_HOSTS = new Set(['artistgrid.cx', 'www.artistgrid.cx']);
const URL_PATTERN = /https?:\/\/[^\s"'<>\\]+/gi;
const MAX_TRACKER_LINKS = 50;
const NON_MEDIA_HOSTS = new Set([
  'accounts.google.com',
  'docs.google.com',
  'google.com',
  'www.google.com',
  'artistgrid.cx',
  'www.artistgrid.cx',
]);

interface TrackerSheet {
  id: string;
  gid: string | null;
}

function trackerSheet(input: string): TrackerSheet | null {
  try {
    const url = new URL(input);
    const google =
      url.hostname === 'docs.google.com'
        ? /^\/spreadsheets(?:\/u\/\d+)?\/d\/([A-Za-z0-9_-]{20,})/.exec(url.pathname)?.[1]
        : null;
    const artistGrid = TRACKERHUB_HOSTS.has(url.hostname.toLowerCase())
      ? /^\/sh\/([A-Za-z0-9_-]{20,})\/?/.exec(url.pathname)?.[1]
      : null;
    const id = google ?? artistGrid;
    return id ? { id, gid: url.searchParams.get('gid') } : null;
  } catch {
    return null;
  }
}

/** Returns the public CSV endpoint for a TrackerHub Google Sheet or ArtistGrid share link. */
export function trackerhubCsvUrl(input: string): string | null {
  const source = trackerSheet(input);
  if (!source) return null;

  const url = new URL(`https://docs.google.com/spreadsheets/d/${source.id}/export`);
  url.searchParams.set('format', 'csv');
  if (source.gid) url.searchParams.set('gid', source.gid);
  return url.toString();
}

function trackerhubHtmlUrl(input: string): string | null {
  const source = trackerSheet(input);
  if (!source) return null;

  const url = new URL(`https://docs.google.com/spreadsheets/d/${source.id}/htmlview`);
  if (source.gid) url.searchParams.set('gid', source.gid);
  return url.toString();
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
    if (NON_MEDIA_HOSTS.has(url.hostname.toLowerCase())) {
      if (
        (url.hostname === 'google.com' || url.hostname === 'www.google.com') &&
        url.pathname === '/url'
      ) {
        const target = url.searchParams.get('q') ?? url.searchParams.get('url');
        return target ? importableUrl(target) : null;
      }
      return null;
    }
    if (url.hostname.endsWith('.googleusercontent.com')) return null;
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
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
  const csvUrl = trackerhubCsvUrl(input);
  const htmlUrl = trackerhubHtmlUrl(input);
  if (!csvUrl || !htmlUrl) throw new Error('Not a supported TrackerHub or Google Sheets URL');

  const csvResponse = await fetch(csvUrl, {
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

  const htmlResponse = await fetch(htmlUrl, {
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
