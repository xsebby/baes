import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgSequence,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Global monotonic sequence stamped onto every syncable row mutation.
// Clients pull deltas with `WHERE updated_seq > :last_seq` — see PRD §5.3.
export const changeSeq = pgSequence('change_seq');

const nextSeq = sql`nextval('change_seq')`;
const updatedSeq = () => bigint('updated_seq', { mode: 'number' }).notNull().default(nextSeq);

export const userRole = pgEnum('user_role', ['owner', 'listener']);
export const playlistSource = pgEnum('playlist_source', ['local', 'spotify']);
export const matchStatus = pgEnum('match_status', [
  'unmatched',
  'auto',
  'confirmed',
  'rejected',
  'candidate',
]);
export const transcodeProfile = pgEnum('transcode_profile', ['original', 'high', 'low']);

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: text('username').notNull().unique(),
  pwHash: text('pw_hash').notNull(),
  role: userRole('role').notNull().default('owner'),
  canDownload: boolean('can_download').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const invites = pgTable('invites', {
  token: text('token').primaryKey(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  usedBy: uuid('used_by').references(() => users.id),
  role: userRole('role').notNull().default('listener'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Only the SHA-256 of the opaque token is stored; the raw token never touches disk.
    tokenHash: text('token_hash').notNull().unique(),
    deviceName: text('device_name').notNull().default('unknown'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

export const libraryRoots = pgTable('library_roots', {
  id: uuid('id').primaryKey().defaultRandom(),
  path: text('path').notNull().unique(),
  enabled: boolean('enabled').notNull().default(true),
  lastScanAt: timestamp('last_scan_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const artists = pgTable('artists', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  sortName: text('sort_name').notNull(),
  updatedSeq: updatedSeq(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const albums = pgTable(
  'albums',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    artistId: uuid('artist_id').references(() => artists.id),
    year: integer('year'),
    artPath: text('art_path'),
    updatedSeq: updatedSeq(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('albums_artist_idx').on(t.artistId)],
);

export const tracks = pgTable(
  'tracks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rootId: uuid('root_id')
      .notNull()
      .references(() => libraryRoots.id),
    relPath: text('rel_path').notNull(),
    contentHash: text('content_hash').notNull(),
    fingerprint: text('fingerprint'),
    title: text('title').notNull(),
    artistId: uuid('artist_id').references(() => artists.id),
    albumId: uuid('album_id').references(() => albums.id),
    trackNo: integer('track_no'),
    discNo: integer('disc_no'),
    durationMs: integer('duration_ms').notNull(),
    codec: text('codec').notNull(),
    bitrate: integer('bitrate'),
    sampleRate: integer('sample_rate'),
    channels: integer('channels'),
    isrc: text('isrc'),
    needsReview: boolean('needs_review').notNull().default(false),
    versionGroupId: uuid('version_group_id'),
    updatedSeq: updatedSeq(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('tracks_root_relpath_idx').on(t.rootId, t.relPath),
    index('tracks_content_hash_idx').on(t.contentHash),
    index('tracks_artist_idx').on(t.artistId),
    index('tracks_album_idx').on(t.albumId),
    index('tracks_updated_seq_idx').on(t.updatedSeq),
    index('tracks_isrc_idx').on(t.isrc),
  ],
);

// ---------------------------------------------------------------------------
// External (Spotify)
// ---------------------------------------------------------------------------

export const externalAccounts = pgTable('external_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull().default('spotify'),
  // AES-256-GCM encrypted with SERVER_SECRET-derived key; never stored plaintext.
  refreshTokenEnc: text('refresh_token_enc').notNull(),
  scopes: text('scopes').notNull(),
  providerUserId: text('provider_user_id'),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const externalTracks = pgTable(
  'external_tracks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull().default('spotify'),
    providerId: text('provider_id').notNull(),
    isrc: text('isrc'),
    title: text('title').notNull(),
    artist: text('artist').notNull(),
    album: text('album'),
    durationMs: integer('duration_ms'),
    artUrl: text('art_url'),
    matchedTrackId: uuid('matched_track_id').references(() => tracks.id),
    matchConfidence: real('match_confidence'),
    matchStatus: matchStatus('match_status').notNull().default('unmatched'),
    updatedSeq: updatedSeq(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('external_tracks_provider_idx').on(t.provider, t.providerId),
    index('external_tracks_isrc_idx').on(t.isrc),
  ],
);

// ---------------------------------------------------------------------------
// Playlists, likes, plays
// ---------------------------------------------------------------------------

export const playlists = pgTable('playlists', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id),
  title: text('title').notNull(),
  source: playlistSource('source').notNull().default('local'),
  providerId: text('provider_id'),
  providerSnapshotId: text('provider_snapshot_id'),
  artPath: text('art_path'),
  updatedSeq: updatedSeq(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const playlistItems = pgTable(
  'playlist_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playlistId: uuid('playlist_id')
      .notNull()
      .references(() => playlists.id, { onDelete: 'cascade' }),
    // Fractional index (LexoRank-style string) — concurrent reorders merge without renumbering.
    sortKey: text('sort_key').notNull(),
    trackId: uuid('track_id').references(() => tracks.id),
    externalTrackId: uuid('external_track_id').references(() => externalTracks.id),
    addedBy: uuid('added_by').references(() => users.id),
    updatedSeq: updatedSeq(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('playlist_items_playlist_idx').on(t.playlistId, t.sortKey)],
);

export const likes = pgTable(
  'likes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    trackId: uuid('track_id').references(() => tracks.id),
    externalTrackId: uuid('external_track_id').references(() => externalTracks.id),
    updatedSeq: updatedSeq(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('likes_user_track_idx').on(t.userId, t.trackId),
    uniqueIndex('likes_user_external_idx').on(t.userId, t.externalTrackId),
  ],
);

export const playEvents = pgTable(
  'play_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    trackId: uuid('track_id').references(() => tracks.id),
    externalTrackId: uuid('external_track_id').references(() => externalTracks.id),
    deviceId: text('device_id').notNull(),
    playedMs: integer('played_ms').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('play_events_user_started_idx').on(t.userId, t.startedAt)],
);

export const playerState = pgTable(
  'player_state',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: text('device_id').notNull(),
    trackId: uuid('track_id').references(() => tracks.id),
    externalTrackId: uuid('external_track_id').references(() => externalTracks.id),
    positionMs: integer('position_ms').notNull().default(0),
    queue: jsonb('queue'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('player_state_user_device_idx').on(t.userId, t.deviceId)],
);

// ---------------------------------------------------------------------------
// Transcode cache
// ---------------------------------------------------------------------------

export const transcodeCache = pgTable(
  'transcode_cache',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    trackId: uuid('track_id')
      .notNull()
      .references(() => tracks.id, { onDelete: 'cascade' }),
    profile: transcodeProfile('profile').notNull(),
    path: text('path').notNull(),
    bytes: bigint('bytes', { mode: 'number' }).notNull(),
    lastAccessAt: timestamp('last_access_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('transcode_track_profile_idx').on(t.trackId, t.profile)],
);
