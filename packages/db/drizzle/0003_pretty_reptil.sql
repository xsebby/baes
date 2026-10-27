CREATE TABLE "tag_labels" (
	"tag" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tracks" ADD COLUMN "tag" text;--> statement-breakpoint
ALTER TABLE "tracks" ADD COLUMN "raw_title" text;