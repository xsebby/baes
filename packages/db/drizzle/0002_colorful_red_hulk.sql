CREATE TABLE "duplicate_pairs" (
	"track_a" uuid NOT NULL,
	"track_b" uuid NOT NULL,
	"votes" integer NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dismissed_at" timestamp with time zone,
	CONSTRAINT "duplicate_pairs_track_a_track_b_pk" PRIMARY KEY("track_a","track_b")
);
--> statement-breakpoint
CREATE TABLE "track_fingerprints" (
	"track_id" uuid PRIMARY KEY NOT NULL,
	"content_hash" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "duplicate_pairs" ADD CONSTRAINT "duplicate_pairs_track_a_tracks_id_fk" FOREIGN KEY ("track_a") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_pairs" ADD CONSTRAINT "duplicate_pairs_track_b_tracks_id_fk" FOREIGN KEY ("track_b") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_fingerprints" ADD CONSTRAINT "track_fingerprints_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;