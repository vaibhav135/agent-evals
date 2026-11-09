CREATE TYPE "public"."experiment_status" AS ENUM('pending', 'running', 'completed', 'cancelled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."memory_mode" AS ENUM('off', 'on', 'seeded');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'passed', 'failed', 'agent_error', 'timeout', 'infra_error');--> statement-breakpoint
CREATE TYPE "public"."skill_mode" AS ENUM('installed', 'pinned');--> statement-breakpoint
CREATE TYPE "public"."task_category" AS ENUM('skill', 'control', 'memory');--> statement-breakpoint
CREATE TABLE "agent_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"provider" text DEFAULT 'anthropic' NOT NULL,
	"model" text NOT NULL,
	"skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"skill_mode" "skill_mode" DEFAULT 'installed' NOT NULL,
	"memory_mode" "memory_mode" DEFAULT 'off' NOT NULL,
	"memory_seed" text,
	"toolsets" text[] NOT NULL,
	"max_iterations" integer DEFAULT 30 NOT NULL,
	"run_budget_s" integer DEFAULT 300 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_configs_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "experiment_arms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experiment_id" uuid NOT NULL,
	"label" text NOT NULL,
	"config_id" uuid,
	"config_snapshot" jsonb NOT NULL,
	CONSTRAINT "experiment_arms_label_uq" UNIQUE("experiment_id","label"),
	CONSTRAINT "experiment_arms_label_ck" CHECK ("experiment_arms"."label" in ('A', 'B'))
);
--> statement-breakpoint
CREATE TABLE "experiments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"suite_id" uuid NOT NULL,
	"trials_per_task" integer NOT NULL,
	"status" "experiment_status" DEFAULT 'pending' NOT NULL,
	"hermes_commit" text NOT NULL,
	"judge_model" text,
	"concurrency" integer DEFAULT 4 NOT NULL,
	"seed" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "grader_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"grader_idx" integer NOT NULL,
	"type" text NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"passed" boolean NOT NULL,
	"score" double precision NOT NULL,
	"reason" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"judge_prompt_version" text,
	CONSTRAINT "grader_results_run_idx_uq" UNIQUE("run_id","grader_idx")
);
--> statement-breakpoint
CREATE TABLE "run_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"idx" integer NOT NULL,
	"prompt" text NOT NULL,
	"final_response" text,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"available_tools" text[] DEFAULT '{}'::text[] NOT NULL,
	"outcome" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"memory_snapshot" jsonb,
	"usage" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"duration_ms" integer,
	CONSTRAINT "run_sessions_run_idx_uq" UNIQUE("run_id","idx")
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experiment_id" uuid NOT NULL,
	"arm_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"trial_index" integer NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"passed" boolean,
	"score" double precision,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision,
	"duration_ms" integer,
	"turns" integer,
	"tool_calls" integer,
	"error_kind" text,
	"error_message" text,
	"task_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runs_arm_task_trial_uq" UNIQUE("arm_id","task_id","trial_index")
);
--> statement-breakpoint
CREATE TABLE "suites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suites_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"suite_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"category" "task_category" NOT NULL,
	"sessions" jsonb NOT NULL,
	"fixtures" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"graders" jsonb NOT NULL,
	"timeout_s" integer DEFAULT 300 NOT NULL,
	"max_iterations" integer DEFAULT 30 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_suite_slug_uq" UNIQUE("suite_id","slug")
);
--> statement-breakpoint
ALTER TABLE "experiment_arms" ADD CONSTRAINT "experiment_arms_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_arms" ADD CONSTRAINT "experiment_arms_config_id_agent_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."agent_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_suite_id_suites_id_fk" FOREIGN KEY ("suite_id") REFERENCES "public"."suites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grader_results" ADD CONSTRAINT "grader_results_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_sessions" ADD CONSTRAINT "run_sessions_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_arm_id_experiment_arms_id_fk" FOREIGN KEY ("arm_id") REFERENCES "public"."experiment_arms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_suite_id_suites_id_fk" FOREIGN KEY ("suite_id") REFERENCES "public"."suites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runs_queue_idx" ON "runs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "runs_experiment_idx" ON "runs" USING btree ("experiment_id");