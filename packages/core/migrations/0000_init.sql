CREATE TABLE "audit_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"job_id" uuid,
	"run_id" uuid,
	"event_type" text NOT NULL,
	"actor" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crawl_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"goal" text NOT NULL,
	"starting_url" text NOT NULL,
	"requested_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"output_formats" jsonb DEFAULT '["json"]'::jsonb NOT NULL,
	"robots_policy" text DEFAULT 'respect' NOT NULL,
	"scope" text DEFAULT 'section' NOT NULL,
	"max_pages" integer,
	"max_depth" integer,
	"status" text DEFAULT 'created' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crawl_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"config_version" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"pages_fetched" integer DEFAULT 0 NOT NULL,
	"pages_extracted" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "extracted_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"page_url" text NOT NULL,
	"record_index" integer DEFAULT 0 NOT NULL,
	"payload" jsonb NOT NULL,
	"confidence" numeric(4, 3),
	"extracted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fetch_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"url" text NOT NULL,
	"final_url" text,
	"status_code" integer,
	"tier_used" text NOT NULL,
	"timing_ms" integer,
	"error" text,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategy_config" (
	"job_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_validated" timestamp with time zone,
	"reason" text NOT NULL,
	CONSTRAINT "strategy_config_job_id_version_pk" PRIMARY KEY("job_id","version")
);
--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_job_id_crawl_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."crawl_job"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_run_id_crawl_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."crawl_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_run" ADD CONSTRAINT "crawl_run_job_id_crawl_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."crawl_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extracted_record" ADD CONSTRAINT "extracted_record_run_id_crawl_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."crawl_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fetch_attempt" ADD CONSTRAINT "fetch_attempt_run_id_crawl_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."crawl_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_config" ADD CONSTRAINT "strategy_config_job_id_crawl_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."crawl_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_event_job_idx" ON "audit_event" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "audit_event_created_at_idx" ON "audit_event" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_event_type_idx" ON "audit_event" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "crawl_job_status_idx" ON "crawl_job" USING btree ("status");--> statement-breakpoint
CREATE INDEX "crawl_job_created_at_idx" ON "crawl_job" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "crawl_run_job_idx" ON "crawl_run" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "crawl_run_status_idx" ON "crawl_run" USING btree ("status");--> statement-breakpoint
CREATE INDEX "extracted_record_run_idx" ON "extracted_record" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "extracted_record_run_page_idx" ON "extracted_record" USING btree ("run_id","page_url");--> statement-breakpoint
CREATE INDEX "fetch_attempt_run_idx" ON "fetch_attempt" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "fetch_attempt_status_idx" ON "fetch_attempt" USING btree ("status_code");