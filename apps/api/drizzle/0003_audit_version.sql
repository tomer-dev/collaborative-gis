ALTER TABLE "audit_log" ADD COLUMN "version" integer;--> statement-breakpoint
ALTER TABLE "audit_log" DROP COLUMN "payload_hash";