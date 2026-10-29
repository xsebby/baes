import { useEffect, type ReactNode } from 'react';

// ---- Terms and privacy (/terms, /privacy, no account) ----

const UPDATED = 'October 29, 2026';
const CONTACT = 'contact@sebby.dev';

const Email = () => <a href={`mailto:${CONTACT}`}>{CONTACT}</a>;

const CONTACT_SECTION = {
  h: 'Contact',
  body: (
    <p>
      Questions, rights complaints or data requests: <Email />.
    </p>
  ),
};

type Doc = 'terms' | 'privacy';

const TITLES: Record<Doc, string> = {
  terms: 'Terms of Service',
  privacy: 'Privacy Policy',
};

const TERMS: { h: string; body: ReactNode }[] = [
  {
    h: 'What bæs is',
    body: (
      <p>
        bæs is a private, invite-only music server run by one person (“the owner”). These terms
        cover the site at this address, the bæs apps, and share links (<code>/s/…</code>). By using
        any of them you agree to these terms.
      </p>
    ),
  },
  {
    h: 'Accounts',
    body: (
      <ul>
        <li>
          Accounts are by invite only. The owner can suspend or remove any account at any time.
        </li>
        <li>
          Keep your password to yourself. You're responsible for what happens under your account.
        </li>
        <li>Repeated failed sign-ins lock the account for a short time.</li>
      </ul>
    ),
  },
  {
    h: 'Your uploads',
    body: (
      <ul>
        <li>
          Only upload or import audio you have the right to store and listen to. You keep whatever
          rights you have in it.
        </li>
        <li>
          By uploading, you allow bæs to store, process (for example, convert formats or detect
          duplicates) and stream that file to you and to people you share it with.
        </li>
        <li>The owner can remove any file, for any reason, including a rights complaint.</li>
      </ul>
    ),
  },
  {
    h: 'Share links',
    body: (
      <ul>
        <li>
          Anyone who has a share link can play what it points to, and download it if downloads are
          on. Links are only sent to people trusted with that music.
        </li>
        <li>
          Links stop working when they expire or are revoked. A copy someone already downloaded
          can't be taken back.
        </li>
        <li>If you received a link, it's for listening. Don't republish or redistribute it.</li>
      </ul>
    ),
  },
  {
    h: "Don't",
    body: (
      <ul>
        <li>Try to get into accounts, files or parts of the server that aren't yours.</li>
        <li>Overload the server, scrape it, or get around its limits.</li>
        <li>Use bæs to share music publicly or to distribute things you don't have rights to.</li>
      </ul>
    ),
  },
  {
    h: 'Rights complaints',
    body: (
      <p>
        If you believe something on bæs infringes your rights, email <Email /> with the share link
        or track name and what you own. It will be reviewed and removed if the complaint is valid.
      </p>
    ),
  },
  {
    h: 'No warranty',
    body: (
      <p>
        bæs is a personal project provided “as is”. It can go down, lose data, or change without
        notice. Keep your own copies of anything that matters. To the extent the law allows, the
        owner isn't liable for losses that come from using it.
      </p>
    ),
  },
  {
    h: 'Changes',
    body: (
      <p>
        These terms may change. The date at the top shows the latest version, and using bæs after a
        change means you accept it.
      </p>
    ),
  },
  CONTACT_SECTION,
];

const PRIVACY: { h: string; body: ReactNode }[] = [
  {
    h: 'The short version',
    body: (
      <p>
        bæs keeps what it needs to run your library and nothing else. There are no ads, no analytics
        and no trackers, and your data is never sold or shared for marketing.
      </p>
    ),
  },
  {
    h: 'What is stored',
    body: (
      <ul>
        <li>
          <strong>Account:</strong> your username and a hashed password (never the password itself),
          your role, and when the account was created.
        </li>
        <li>
          <strong>Sessions:</strong> one record per signed-in device, with a device name and when it
          was last used. Only a hash of the session token is stored.
        </li>
        <li>
          <strong>Your library:</strong> files you upload or import, their tags and artwork, your
          playlists and likes.
        </li>
        <li>
          <strong>Listening:</strong> what you played and for how long, and where you left off on
          each device, so you can resume.
        </li>
        <li>
          <strong>Share links:</strong> what was shared, by whom, the expiry, and a view count.
          Viewers of a share link are not identified.
        </li>
        <li>
          <strong>Spotify (optional):</strong> if you connect Spotify, an encrypted Spotify token
          and your playlists' track lists, used only to mirror them.
        </li>
      </ul>
    ),
  },
  {
    h: 'Server logs',
    body: (
      <p>
        Like most servers, bæs logs requests, including IP addresses. The logs are only used for
        security and fixing problems, and they're rotated automatically, so old entries are
        overwritten. Failed sign-ins are counted per account and per IP to block password guessing.
        Those counters are kept in memory and cleared within minutes.
      </p>
    ),
  },
  {
    h: 'In your browser',
    body: (
      <p>
        The web app keeps your sign-in token, theme and volume in your browser's local storage.
        There are no cookies for tracking.
      </p>
    ),
  },
  {
    h: 'Where it lives',
    body: (
      <p>
        Everything is stored on a server the owner rents from DigitalOcean, with nightly backups
        kept for 7 days and an offline copy held by the owner. If you connect Spotify, bæs talks to
        Spotify's API on your behalf. No other services receive your data.
      </p>
    ),
  },
  {
    h: 'Deleting your data',
    body: (
      <p>
        Email <Email /> and your account will be deleted, along with your sessions, playlists, likes
        and listening history. Backups containing it age out within 7 days.
      </p>
    ),
  },
  {
    h: 'Changes',
    body: <p>If this policy changes, the date at the top will change with it.</p>,
  },
  CONTACT_SECTION,
];

export function LegalPage({ doc }: { doc: Doc }) {
  useEffect(() => {
    document.title = `${TITLES[doc]} · bæs`;
  }, [doc]);
  const sections = doc === 'terms' ? TERMS : PRIVACY;
  return (
    <div className="landing legal">
      <header className="landing-nav">
        <a className="landing-logo" href="/">
          bæs
        </a>
        <nav className="legal-nav">
          <a href="/terms" className={doc === 'terms' ? 'active' : ''}>
            Terms
          </a>
          <a href="/privacy" className={doc === 'privacy' ? 'active' : ''}>
            Privacy
          </a>
        </nav>
      </header>
      <article className="legal-body">
        <h1>{TITLES[doc]}</h1>
        <p className="legal-updated">Last updated {UPDATED}</p>
        {sections.map((s) => (
          <section key={s.h}>
            <h2>{s.h}</h2>
            {s.body}
          </section>
        ))}
      </article>
      <LegalLinks />
    </div>
  );
}

/** Small footer row linking the legal pages; used on every public page. */
export function LegalLinks() {
  return (
    <nav className="legal-links">
      <a href="/terms">Terms</a>
      <a href="/privacy">Privacy</a>
    </nav>
  );
}
