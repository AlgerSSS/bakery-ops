-- HOT CRUSH Core V1 R6 / ai physical tables
-- Generated deterministically. Do not hand-edit.
-- The psycopg2 apply runner owns the sole transaction, lock and SET LOCAL state.

CREATE TABLE public."ai_call" (
  "ai_call_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "prompt_template_id" pg_catalog.uuid NOT NULL,
  "job_run_id" pg_catalog.uuid,
  "actor_user_id" pg_catalog.uuid,
  "caller_code" pg_catalog.text NOT NULL,
  "request_id" pg_catalog.text,
  "model_provider" pg_catalog.text NOT NULL,
  "model_name" pg_catalog.text NOT NULL,
  "prompt_redacted" pg_catalog.text NOT NULL,
  "input_manifest" pg_catalog.jsonb DEFAULT '{}'::pg_catalog.jsonb NOT NULL,
  "response_redacted" pg_catalog.text,
  "parsed_output" pg_catalog.jsonb,
  "validation_status" pg_catalog.text NOT NULL,
  "input_tokens" pg_catalog.int4,
  "output_tokens" pg_catalog.int4,
  "cost_usd" pg_catalog.numeric(18,8),
  "latency_ms" pg_catalog.int4,
  "status" pg_catalog.text NOT NULL,
  "started_at" pg_catalog.timestamptz NOT NULL,
  "completed_at" pg_catalog.timestamptz,
  "error_code" pg_catalog.text,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_ai_call__ai_call_id" PRIMARY KEY ("ai_call_id"),
  CONSTRAINT "ck_ai_call__table__01" CHECK ("completed_at" IS NULL OR "completed_at" >= "started_at"),
  CONSTRAINT "ck_ai_call__validation_status__01" CHECK ("validation_status" IN ( 'VALID' , 'INVALID_SCHEMA' , 'SAFETY_BLOCKED' , 'INCOMPLETE' , 'NOT_APPLICABLE' )),
  CONSTRAINT "ck_ai_call__input_tokens__01" CHECK ("input_tokens" IS NULL OR "input_tokens" >= 0),
  CONSTRAINT "ck_ai_call__output_tokens__01" CHECK ("output_tokens" IS NULL OR "output_tokens" >= 0),
  CONSTRAINT "ck_ai_call__cost_usd__01" CHECK ("cost_usd" IS NULL OR "cost_usd" >= 0),
  CONSTRAINT "ck_ai_call__latency_ms__01" CHECK ("latency_ms" IS NULL OR "latency_ms" >= 0),
  CONSTRAINT "ck_ai_call__status__01" CHECK ("status" IN ( 'RUNNING' , 'SUCCEEDED' , 'FAILED' , 'CANCELLED' , 'BLOCKED' ))
);

CREATE TABLE public."ai_prompt_segment" (
  "prompt_segment_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "segment_code" pg_catalog.text NOT NULL,
  "version_no" pg_catalog.int4 NOT NULL,
  "segment_name" pg_catalog.text NOT NULL,
  "segment_category" pg_catalog.text NOT NULL,
  "content" pg_catalog.text NOT NULL,
  "content_sha256" pg_catalog.bpchar(64) NOT NULL,
  "variable_schema" pg_catalog.jsonb DEFAULT '{}'::pg_catalog.jsonb NOT NULL,
  "status" pg_catalog.text DEFAULT 'DRAFT' NOT NULL,
  "approved_by_user_id" pg_catalog.uuid,
  "approved_at" pg_catalog.timestamptz,
  "created_by_user_id" pg_catalog.uuid,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_ai_prompt_segment__prompt_segment_id" PRIMARY KEY ("prompt_segment_id"),
  CONSTRAINT "uq_ai_prompt_segment__segment_code__version_no" UNIQUE ("segment_code", "version_no"),
  CONSTRAINT "ck_ai_prompt_segment__version_no__01" CHECK ("version_no" > 0),
  CONSTRAINT "ck_ai_prompt_segment__segment_category__01" CHECK ("segment_category" IN ( 'ROLE' , 'RULE' , 'KNOWLEDGE' , 'CONTEXT' , 'FORMAT' )),
  CONSTRAINT "ck_ai_prompt_segment__status__01" CHECK ("status" IN ( 'DRAFT' , 'APPROVED' , 'ACTIVE' , 'RETIRED' , 'REJECTED' ))
);

CREATE TABLE public."ai_prompt_template" (
  "prompt_template_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "template_code" pg_catalog.text NOT NULL,
  "version_no" pg_catalog.int4 NOT NULL,
  "template_name" pg_catalog.text NOT NULL,
  "purpose" pg_catalog.text NOT NULL,
  "model_provider" pg_catalog.text NOT NULL,
  "model_name" pg_catalog.text NOT NULL,
  "temperature" pg_catalog.numeric(5,4) DEFAULT 0 NOT NULL,
  "top_p" pg_catalog.numeric(5,4) DEFAULT 1 NOT NULL,
  "output_schema" pg_catalog.jsonb DEFAULT '{}'::pg_catalog.jsonb NOT NULL,
  "safety_policy_version" pg_catalog.text NOT NULL,
  "status" pg_catalog.text NOT NULL,
  "approved_by_user_id" pg_catalog.uuid,
  "approved_at" pg_catalog.timestamptz,
  "created_by_user_id" pg_catalog.uuid,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_ai_prompt_template__prompt_template_id" PRIMARY KEY ("prompt_template_id"),
  CONSTRAINT "uq_ai_prompt_template__template_code__version_no" UNIQUE ("template_code", "version_no"),
  CONSTRAINT "ck_ai_prompt_template__version_no__01" CHECK ("version_no" > 0),
  CONSTRAINT "ck_ai_prompt_template__model_provider__01" CHECK ("model_provider" ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  CONSTRAINT "ck_ai_prompt_template__status__01" CHECK ("status" IN ( 'DRAFT' , 'APPROVED' , 'ACTIVE' , 'RETIRED' , 'REJECTED' ))
);

CREATE TABLE public."ai_prompt_template_segment" (
  "prompt_template_segment_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "prompt_template_id" pg_catalog.uuid NOT NULL,
  "prompt_segment_id" pg_catalog.uuid NOT NULL,
  "sequence_no" pg_catalog.int4 NOT NULL,
  "role" pg_catalog.text NOT NULL,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_ai_prompt_template_segment__prompt_template_segment_id" PRIMARY KEY ("prompt_template_segment_id"),
  CONSTRAINT "uq_ai_prompt_template_segment__prompt_template_id__sequence_no" UNIQUE ("prompt_template_id", "sequence_no"),
  CONSTRAINT "ck_ai_prompt_template_segment__sequence_no__01" CHECK ("sequence_no" > 0),
  CONSTRAINT "ck_ai_prompt_template_segment__role__01" CHECK ("role" IN ( 'SYSTEM' , 'DEVELOPER' , 'USER' , 'CONTEXT' ))
);
