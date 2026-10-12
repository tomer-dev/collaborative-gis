CREATE TABLE "area_versions" (
	"area_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"geom" geometry(Polygon,4326) NOT NULL,
	"area_km2" numeric(14, 6) NOT NULL,
	"changed_by" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "area_versions_area_id_version_pk" PRIMARY KEY("area_id","version")
);
--> statement-breakpoint
CREATE TABLE "areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"geom" geometry(Polygon,4326) NOT NULL,
	"area_km2" numeric(14, 6) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"ip" text,
	"user_agent" text,
	"payload_hash" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "area_versions" ADD CONSTRAINT "area_versions_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "areas_geom_gist" ON "areas" USING gist ("geom") WHERE "areas"."deleted_at" is null;