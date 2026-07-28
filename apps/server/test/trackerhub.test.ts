import { afterEach, describe, expect, it, vi } from 'vitest';
import { trackerhubCsvUrl, trackerhubMediaUrls } from '../src/ingest/trackerhub.js';

describe('TrackerHub import', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('turns Google Sheets and ArtistGrid links into their CSV export endpoint', () => {
    const id = '1ivoRJskby8zykhH_szifY4a1HIQCTnVh6c2WfIfMbkM';
    expect(
      trackerhubCsvUrl(
        `https://docs.google.com/spreadsheets/d/${id}/edit?gid=1962169030#gid=1962169030`,
      ),
    ).toBe(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=1962169030`);
    expect(trackerhubCsvUrl(`https://artistgrid.cx/sh/${id}/recent?artist=Playboi%20Carti`)).toBe(
      `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`,
    );
  });

  it('extracts unique media links from a public tracker export', async () => {
    const mockedFetch = vi.fn(
      async () =>
        new Response(
          'Title,Link\nSong,https://pillows.su/f/abc123def456\nAgain,https://pillows.su/f/abc123def456\nOther,https://example.com/file.mp3',
        ),
    );
    vi.stubGlobal('fetch', mockedFetch);

    await expect(
      trackerhubMediaUrls(
        'https://docs.google.com/spreadsheets/d/1ivoRJskby8zykhH_szifY4a1HIQCTnVh6c2WfIfMbkM/edit?gid=1962169030',
      ),
    ).resolves.toEqual(['https://pillows.su/f/abc123def456', 'https://example.com/file.mp3']);
  });

  it('reads hyperlink targets when the CSV only contains display labels', async () => {
    const mockedFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('Title,Link\nSong,Download'))
      .mockResolvedValueOnce(
        new Response(
          [
            '<a href="https://www.google.com/url?q=https%3A%2F%2Fi.imgur.com%2Fcover.png&amp;sa=D">Cover</a>',
            '<a href="https://www.google.com/url?q=https%3A%2F%2Fpillows.su%2Ff%2Fabc123def456&amp;sa=D">Download</a>',
          ].join(''),
        ),
      );
    vi.stubGlobal('fetch', mockedFetch);

    await expect(
      trackerhubMediaUrls(
        'https://docs.google.com/spreadsheets/d/1ivoRJskby8zykhH_szifY4a1HIQCTnVh6c2WfIfMbkM/edit?gid=1962169030',
      ),
    ).resolves.toEqual(['https://pillows.su/f/abc123def456']);
  });

  it('resolves an ArtistGrid tab name to its Google Sheets gid', async () => {
    const mockedFetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          tab: { name: '🆕 Recent', slug: 'recent', gid: '1962169030' },
        }),
      )
      .mockResolvedValueOnce(new Response('Title,Link\nSong,Download'))
      .mockResolvedValueOnce(
        new Response('<a href="https://pillows.su/f/abc123def456">Download</a>'),
      );
    vi.stubGlobal('fetch', mockedFetch);

    await expect(
      trackerhubMediaUrls(
        'https://artistgrid.cx/sh/1ivoRJskby8zykhH_szifY4a1HIQCTnVh6c2WfIfMbkM/recent?artist=Playboi%20Carti',
      ),
    ).resolves.toEqual(['https://pillows.su/f/abc123def456']);
    expect(mockedFetch).toHaveBeenNthCalledWith(
      3,
      'https://docs.google.com/spreadsheets/d/1ivoRJskby8zykhH_szifY4a1HIQCTnVh6c2WfIfMbkM/htmlview/sheet?headers=true&gid=1962169030',
      expect.objectContaining({ headers: { accept: 'text/html' } }),
    );
  });

  it('resolves ArtistGrid’s main slug to the Unreleased sheet tab', async () => {
    const id = '1ivoRJskby8zykhH_szifY4a1HIQCTnVh6c2WfIfMbkM';
    const mockedFetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          tab: { name: '💿 Unreleased', slug: 'main', gid: '0' },
        }),
      )
      .mockResolvedValueOnce(new Response('Title,Link\nSong,https://pillows.su/f/abc123def456'));
    vi.stubGlobal('fetch', mockedFetch);

    await expect(
      trackerhubMediaUrls(`https://artistgrid.cx/sh/${id}/main?artist=Playboi%20Carti`),
    ).resolves.toEqual(['https://pillows.su/f/abc123def456']);
    expect(mockedFetch).toHaveBeenNthCalledWith(
      2,
      `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=0`,
      expect.objectContaining({ headers: { accept: 'text/csv, text/plain;q=0.9' } }),
    );
  });

  it('imports one ArtistGrid era with optional quality filters and more than 50 tracks', async () => {
    const id = '1ivoRJskby8zykhH_szifY4a1HIQCTnVh6c2WfIfMbkM';
    const matchingTracks = Array.from({ length: 99 }, (_, index) => ({
      quality: index % 2 === 0 ? 'CD Quality' : 'High Quality',
      links: [
        { url: `https://pillows.su/f/${String(index).padStart(32, '0')}` },
        { url: `https://pillows.su/f/duplicate-${index}` },
      ],
    }));
    const mockedFetch = vi.fn(async () =>
      Response.json({
        eras: [
          {
            name: 'Whole Lotta Red [V1]',
            tracks: [
              ...matchingTracks,
              {
                quality: 'Low Quality',
                links: [{ url: 'https://pillows.su/f/low-quality-track' }],
              },
            ],
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', mockedFetch);

    const url =
      `https://artistgrid.cx/sh/${id}/main?artist=Playboi%20Carti` +
      '&era=Whole%20Lotta%20Red%20%5BV1%5D' +
      '&quality=CD%20Quality&quality=High%20Quality';
    const links = await trackerhubMediaUrls(url);

    expect(links).toHaveLength(99);
    expect(links[0]).toBe('https://pillows.su/f/00000000000000000000000000000000');
    expect(links).not.toContain('https://pillows.su/f/low-quality-track');
    expect(mockedFetch).toHaveBeenCalledWith(
      `https://trackerapi.artistgrid.cx/sh/${id}/tab/main`,
      expect.objectContaining({ headers: { accept: 'application/json' } }),
    );
  });

  it('reports available ArtistGrid eras when the selector is wrong', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          eras: [
            { name: 'Whole Lotta Red [V1]', tracks: [] },
            { name: 'Whole Lotta Red [V2]', tracks: [] },
          ],
        }),
      ),
    );

    await expect(
      trackerhubMediaUrls(
        'https://artistgrid.cx/sh/1ivoRJskby8zykhH_szifY4a1HIQCTnVh6c2WfIfMbkM/main?era=Wrong',
      ),
    ).rejects.toThrow('Available eras include: Whole Lotta Red [V1], Whole Lotta Red [V2]');
  });

  it('explains when the linked sheet is not publicly exportable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            '<!doctype html><title>Google Sheets: Sign-in</title><p>to continue to Google Sheets</p>',
          ),
      ),
    );

    await expect(
      trackerhubMediaUrls(
        'https://docs.google.com/spreadsheets/d/1ivoRJskby8zykhH_szifY4a1HIQCTnVh6c2WfIfMbkM/edit',
      ),
    ).rejects.toThrow('not publicly exportable');
  });
});
