CREATE TABLE "album_tracklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracklist_id" uuid NOT NULL,
	"track_id" uuid NOT NULL,
	"sort_key" text NOT NULL,
	"updated_seq" bigint DEFAULT nextval('change_seq') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "album_tracklists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"album_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid,
	"updated_seq" bigint DEFAULT nextval('change_seq') NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "album_tracklist_items" ADD CONSTRAINT "album_tracklist_items_tracklist_id_album_tracklists_id_fk" FOREIGN KEY ("tracklist_id") REFERENCES "public"."album_tracklists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "album_tracklist_items" ADD CONSTRAINT "album_tracklist_items_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "album_tracklists" ADD CONSTRAINT "album_tracklists_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "album_tracklists" ADD CONSTRAINT "album_tracklists_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "album_tracklist_items_list_idx" ON "album_tracklist_items" USING btree ("tracklist_id","sort_key");--> statement-breakpoint
CREATE INDEX "album_tracklists_album_idx" ON "album_tracklists" USING btree ("album_id");