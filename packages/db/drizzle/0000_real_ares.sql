CREATE TYPE "public"."match_status" AS ENUM('unmatched', 'auto', 'confirmed', 'rejected', 'candidate');--> statement-breakpoint
CREATE TYPE "public"."playlist_source" AS ENUM('local', 'spotify');--> statement-breakpoint
CREATE TYPE "public"."transcode_profile" AS ENUM('original', 'high', 'low');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'listener');--> statement-breakpoint
CREATE SEQUENCE "public"."change_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "albums" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"artist_id" uuid,
	"year" integer,
	"art_path" text,
	"updated_seq" bigint DEFAULT nextval('change_seq') NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "artists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"sort_name" text NOT NULL,
	"updated_seq" bigint DEFAULT nextval('change_seq') NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "external_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text DEFAULT 'spotify' NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"scopes" text NOT NULL,
	"provider_user_id" text,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text DEFAULT 'spotify' NOT NULL,
	"provider_id" text NOT NULL,
	"isrc" text,
	"title" text NOT NULL,
	"artist" text NOT NULL,
	"album" text,
	"duration_ms" integer,
	"art_url" text,
	"matched_track_id" uuid,
	"match_confidence" real,
	"match_status" "match_status" DEFAULT 'unmatched' NOT NULL,
	"updated_seq" bigint DEFAULT nextval('change_seq') NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"token" text PRIMARY KEY NOT NULL,
	"created_by" uuid NOT NULL,
	"used_by" uuid,
	"role" "user_role" DEFAULT 'listener' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_roots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"path" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_scan_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_roots_path_unique" UNIQUE("path")
);
--> statement-breakpoint
CREATE TABLE "likes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"track_id" uuid,
	"external_track_id" uuid,
	"updated_seq" bigint DEFAULT nextval('change_seq') NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "play_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"track_id" uuid,
	"external_track_id" uuid,
	"device_id" text NOT NULL,
	"played_ms" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" text NOT NULL,
	"track_id" uuid,
	"external_track_id" uuid,
	"position_ms" integer DEFAULT 0 NOT NULL,
	"queue" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playlist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"playlist_id" uuid NOT NULL,
	"sort_key" text NOT NULL,
	"track_id" uuid,
	"external_track_id" uuid,
	"added_by" uuid,
	"updated_seq" bigint DEFAULT nextval('change_seq') NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "playlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" text NOT NULL,
	"source" "playlist_source" DEFAULT 'local' NOT NULL,
	"provider_id" text,
	"provider_snapshot_id" text,
	"art_path" text,
	"updated_seq" bigint DEFAULT nextval('change_seq') NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"device_name" text DEFAULT 'unknown' NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"root_id" uuid NOT NULL,
	"rel_path" text NOT NULL,
	"content_hash" text NOT NULL,
	"fingerprint" text,
	"title" text NOT NULL,
	"artist_id" uuid,
	"album_id" uuid,
	"track_no" integer,
	"disc_no" integer,
	"duration_ms" integer NOT NULL,
	"codec" text NOT NULL,
	"bitrate" integer,
	"sample_rate" integer,
	"channels" integer,
	"isrc" text,
	"needs_review" boolean DEFAULT false NOT NULL,
	"version_group_id" uuid,
	"updated_seq" bigint DEFAULT nextval('change_seq') NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "transcode_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"track_id" uuid NOT NULL,
	"profile" "transcode_profile" NOT NULL,
	"path" text NOT NULL,
	"bytes" bigint NOT NULL,
	"last_access_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"pw_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'owner' NOT NULL,
	"can_download" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "albums" ADD CONSTRAINT "albums_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_accounts" ADD CONSTRAINT "external_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_tracks" ADD CONSTRAINT "external_tracks_matched_track_id_tracks_id_fk" FOREIGN KEY ("matched_track_id") REFERENCES "public"."tracks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_used_by_users_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "likes" ADD CONSTRAINT "likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "likes" ADD CONSTRAINT "likes_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "likes" ADD CONSTRAINT "likes_external_track_id_external_tracks_id_fk" FOREIGN KEY ("external_track_id") REFERENCES "public"."external_tracks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play_events" ADD CONSTRAINT "play_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play_events" ADD CONSTRAINT "play_events_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play_events" ADD CONSTRAINT "play_events_external_track_id_external_tracks_id_fk" FOREIGN KEY ("external_track_id") REFERENCES "public"."external_tracks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_state" ADD CONSTRAINT "player_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_state" ADD CONSTRAINT "player_state_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_state" ADD CONSTRAINT "player_state_external_track_id_external_tracks_id_fk" FOREIGN KEY ("external_track_id") REFERENCES "public"."external_tracks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlist_items" ADD CONSTRAINT "playlist_items_playlist_id_playlists_id_fk" FOREIGN KEY ("playlist_id") REFERENCES "public"."playlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlist_items" ADD CONSTRAINT "playlist_items_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlist_items" ADD CONSTRAINT "playlist_items_external_track_id_external_tracks_id_fk" FOREIGN KEY ("external_track_id") REFERENCES "public"."external_tracks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlist_items" ADD CONSTRAINT "playlist_items_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlists" ADD CONSTRAINT "playlists_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_root_id_library_roots_id_fk" FOREIGN KEY ("root_id") REFERENCES "public"."library_roots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcode_cache" ADD CONSTRAINT "transcode_cache_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "albums_artist_idx" ON "albums" USING btree ("artist_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_tracks_provider_idx" ON "external_tracks" USING btree ("provider","provider_id");--> statement-breakpoint
CREATE INDEX "external_tracks_isrc_idx" ON "external_tracks" USING btree ("isrc");--> statement-breakpoint
CREATE UNIQUE INDEX "likes_user_track_idx" ON "likes" USING btree ("user_id","track_id");--> statement-breakpoint
CREATE UNIQUE INDEX "likes_user_external_idx" ON "likes" USING btree ("user_id","external_track_id");--> statement-breakpoint
CREATE INDEX "play_events_user_started_idx" ON "play_events" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "player_state_user_device_idx" ON "player_state" USING btree ("user_id","device_id");--> statement-breakpoint
CREATE INDEX "playlist_items_playlist_idx" ON "playlist_items" USING btree ("playlist_id","sort_key");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tracks_root_relpath_idx" ON "tracks" USING btree ("root_id","rel_path");--> statement-breakpoint
CREATE INDEX "tracks_content_hash_idx" ON "tracks" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "tracks_artist_idx" ON "tracks" USING btree ("artist_id");--> statement-breakpoint
CREATE INDEX "tracks_album_idx" ON "tracks" USING btree ("album_id");--> statement-breakpoint
CREATE INDEX "tracks_updated_seq_idx" ON "tracks" USING btree ("updated_seq");--> statement-breakpoint
CREATE INDEX "tracks_isrc_idx" ON "tracks" USING btree ("isrc");--> statement-breakpoint
CREATE UNIQUE INDEX "transcode_track_profile_idx" ON "transcode_cache" USING btree ("track_id","profile");