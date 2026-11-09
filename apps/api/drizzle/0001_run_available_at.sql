DROP INDEX "runs_queue_idx";--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "available_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "runs_queue_idx" ON "runs" USING btree ("status","available_at","created_at");