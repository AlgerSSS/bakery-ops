-- HOT CRUSH Core V1 R6 / mkt physical tables
-- Generated deterministically. Do not hand-edit.
-- The psycopg2 apply runner owns the sole transaction, lock and SET LOCAL state.

CREATE TABLE public."mkt_campaign_member" (
  "campaign_member_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "campaign_version_id" pg_catalog.uuid NOT NULL,
  "member_id" pg_catalog.uuid NOT NULL,
  "eligibility_status" pg_catalog.text NOT NULL,
  "eligibility_evidence" pg_catalog.jsonb DEFAULT '{}'::pg_catalog.jsonb NOT NULL,
  "invited_at" pg_catalog.timestamptz,
  "started_at" pg_catalog.timestamptz,
  "completed_at" pg_catalog.timestamptz,
  "status" pg_catalog.text DEFAULT 'INVITED' NOT NULL,
  "completion_version" pg_catalog.text,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_mkt_campaign_member__campaign_member_id" PRIMARY KEY ("campaign_member_id"),
  CONSTRAINT "uq_mkt_campaign_member__campaign_version_id__member_id" UNIQUE ("campaign_version_id", "member_id"),
  CONSTRAINT "ck_mkt_campaign_member__eligibility_status__01" CHECK ("eligibility_status" IN ( 'ELIGIBLE' , 'INELIGIBLE' , 'PENDING' , 'OVERRIDDEN' )),
  CONSTRAINT "ck_mkt_campaign_member__status__01" CHECK ("status" IN ( 'INVITED' , 'STARTED' , 'COMPLETED' , 'EXPIRED' , 'CANCELLED' , 'BLOCKED' ))
);

CREATE TABLE public."mkt_campaign_version" (
  "campaign_version_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "campaign_code" pg_catalog.text NOT NULL,
  "campaign_name" pg_catalog.text NOT NULL,
  "campaign_type" pg_catalog.text NOT NULL,
  "location_id" pg_catalog.uuid,
  "version_no" pg_catalog.int4 NOT NULL,
  "starts_at" pg_catalog.timestamptz,
  "ends_at" pg_catalog.timestamptz,
  "rule_schema_version" pg_catalog.text DEFAULT 'campaign-rules-v1' NOT NULL,
  "audience_rule" pg_catalog.jsonb DEFAULT '{}'::pg_catalog.jsonb NOT NULL,
  "participation_rule" pg_catalog.jsonb DEFAULT '{}'::pg_catalog.jsonb NOT NULL,
  "result_algorithm_version" pg_catalog.text,
  "result_schema_version" pg_catalog.text,
  "reward_rule" pg_catalog.jsonb DEFAULT '{}'::pg_catalog.jsonb NOT NULL,
  "status" pg_catalog.text NOT NULL,
  "approved_by_user_id" pg_catalog.uuid,
  "approved_at" pg_catalog.timestamptz,
  "created_by_user_id" pg_catalog.uuid,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_mkt_campaign_version__campaign_version_id" PRIMARY KEY ("campaign_version_id"),
  CONSTRAINT "uq_mkt_campaign_version__campaign_code__version_no" UNIQUE ("campaign_code", "version_no"),
  CONSTRAINT "ck_mkt_campaign_version__table__01" CHECK ("ends_at" IS NULL OR "ends_at" > "starts_at"),
  CONSTRAINT "ck_mkt_campaign_version__table__02" CHECK ("starts_at" IS NOT NULL OR ( "status" = 'ARCHIVED' AND "ends_at" IS NULL )),
  CONSTRAINT "ck_mkt_campaign_version__campaign_type__01" CHECK ("campaign_type" IN ( 'SURVEY' , 'PROMOTION' , 'LOYALTY' , 'COUPON' , 'OTHER' )),
  CONSTRAINT "ck_mkt_campaign_version__version_no__01" CHECK ("version_no" > 0),
  CONSTRAINT "ck_mkt_campaign_version__status__01" CHECK ("status" IN ( 'DRAFT' , 'APPROVED' , 'PUBLISHED' , 'PAUSED' , 'COMPLETED' , 'ARCHIVED' , 'SUPERSEDED' , 'CANCELLED' )),
  CONSTRAINT "ex_mkt_campaign_version__published_period" EXCLUDE USING gist (
      "campaign_code" WITH =,
      pg_catalog.tstzrange("starts_at", "ends_at", '[)') WITH &&
    ) WHERE ("status" = 'PUBLISHED') DEFERRABLE INITIALLY IMMEDIATE
);

CREATE TABLE public."mkt_reward" (
  "reward_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "reward_code" pg_catalog.text NOT NULL,
  "reward_name" pg_catalog.text NOT NULL,
  "reward_type" pg_catalog.text NOT NULL,
  "product_id" pg_catalog.uuid,
  "status" pg_catalog.text DEFAULT 'ACTIVE' NOT NULL,
  "created_by_user_id" pg_catalog.uuid,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_mkt_reward__reward_id" PRIMARY KEY ("reward_id"),
  CONSTRAINT "uq_mkt_reward__reward_code" UNIQUE ("reward_code"),
  CONSTRAINT "ck_mkt_reward__reward_type__01" CHECK ("reward_type" IN ( 'PHYSICAL_GIFT' , 'COUPON' , 'POINTS' , 'BENEFIT' )),
  CONSTRAINT "ck_mkt_reward__status__01" CHECK ("status" IN ( 'ACTIVE' , 'SUSPENDED' , 'RETIRED' ))
);

CREATE TABLE public."mkt_reward_claim" (
  "reward_claim_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "campaign_member_id" pg_catalog.uuid NOT NULL,
  "reward_stock_id" pg_catalog.uuid,
  "reward_id" pg_catalog.uuid NOT NULL,
  "survey_result_id" pg_catalog.uuid,
  "idempotency_key" pg_catalog.bpchar(64) NOT NULL,
  "quantity" pg_catalog.int4 DEFAULT 1 NOT NULL,
  "status" pg_catalog.text NOT NULL,
  "reserved_at" pg_catalog.timestamptz,
  "expires_at" pg_catalog.timestamptz,
  "redeemed_at" pg_catalog.timestamptz,
  "redeemed_by_user_id" pg_catalog.uuid,
  "source_system_id" pg_catalog.uuid,
  "source_fulfillment_id" pg_catalog.text,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_mkt_reward_claim__reward_claim_id" PRIMARY KEY ("reward_claim_id"),
  CONSTRAINT "uq_mkt_reward_claim__idempotency_key" UNIQUE ("idempotency_key"),
  CONSTRAINT "uq_mkt_reward_claim__source_system_id__source_fulfillment_id" UNIQUE NULLS DISTINCT ("source_system_id", "source_fulfillment_id"),
  CONSTRAINT "ck_mkt_reward_claim__table__01" CHECK ("expires_at" IS NULL OR ( "reserved_at" IS NOT NULL AND "expires_at" > "reserved_at" )),
  CONSTRAINT "ck_mkt_reward_claim__table__02" CHECK (( "source_system_id" IS NULL ) = ( "source_fulfillment_id" IS NULL )),
  CONSTRAINT "ck_mkt_reward_claim__table__03" CHECK ("reward_stock_id" IS NOT NULL OR ( "source_system_id" IS NOT NULL AND "source_fulfillment_id" IS NOT NULL )),
  CONSTRAINT "ck_mkt_reward_claim__table__04" CHECK ("status" <> 'REDEEMED' OR "redeemed_at" IS NOT NULL),
  CONSTRAINT "ck_mkt_reward_claim__quantity__01" CHECK ("quantity" > 0),
  CONSTRAINT "ck_mkt_reward_claim__status__01" CHECK ("status" IN ( 'RESERVED' , 'REDEEMED' , 'EXPIRED' , 'CANCELLED' , 'REJECTED' )),
  CONSTRAINT "ck_mkt_reward_claim__source_fulfillment_id__01" CHECK ("source_fulfillment_id" IS NULL OR pg_catalog.btrim ( "source_fulfillment_id" ) <> '')
);

CREATE TABLE public."mkt_reward_stock" (
  "reward_stock_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "campaign_version_id" pg_catalog.uuid NOT NULL,
  "location_id" pg_catalog.uuid,
  "reward_id" pg_catalog.uuid NOT NULL,
  "allocated_quantity" pg_catalog.int4 NOT NULL,
  "unit_cost_estimate" pg_catalog.numeric(18,4),
  "currency" pg_catalog.bpchar(3),
  "reserved_quantity" pg_catalog.int4 DEFAULT 0 NOT NULL,
  "redeemed_quantity" pg_catalog.int4 DEFAULT 0 NOT NULL,
  "damaged_quantity" pg_catalog.int4 DEFAULT 0 NOT NULL,
  "version_no" pg_catalog.int4 DEFAULT 1 NOT NULL,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_mkt_reward_stock__reward_stock_id" PRIMARY KEY ("reward_stock_id"),
  CONSTRAINT "uq_mkt_reward_stock__campaign_version_id__location_i_6dc5150759" UNIQUE NULLS NOT DISTINCT ("campaign_version_id", "location_id", "reward_id"),
  CONSTRAINT "uq_mkt_reward_stock__reward_stock_id__reward_id" UNIQUE ("reward_stock_id", "reward_id"),
  CONSTRAINT "ck_mkt_reward_stock__table__01" CHECK ("reserved_quantity" + "redeemed_quantity" + "damaged_quantity" <= "allocated_quantity"),
  CONSTRAINT "ck_mkt_reward_stock__table__02" CHECK (( "unit_cost_estimate" IS NULL ) = ( "currency" IS NULL )),
  CONSTRAINT "ck_mkt_reward_stock__allocated_quantity__01" CHECK ("allocated_quantity" >= 0),
  CONSTRAINT "ck_mkt_reward_stock__unit_cost_estimate__01" CHECK ("unit_cost_estimate" IS NULL OR "unit_cost_estimate" >= 0),
  CONSTRAINT "ck_mkt_reward_stock__reserved_quantity__01" CHECK ("reserved_quantity" >= 0),
  CONSTRAINT "ck_mkt_reward_stock__redeemed_quantity__01" CHECK ("redeemed_quantity" >= 0),
  CONSTRAINT "ck_mkt_reward_stock__damaged_quantity__01" CHECK ("damaged_quantity" >= 0),
  CONSTRAINT "ck_mkt_reward_stock__version_no__01" CHECK ("version_no" > 0)
);

CREATE TABLE public."mkt_survey_answer" (
  "survey_answer_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "survey_response_id" pg_catalog.uuid NOT NULL,
  "survey_question_id" pg_catalog.uuid NOT NULL,
  "value_index" pg_catalog.int4 DEFAULT 1 NOT NULL,
  "selected_option_id" pg_catalog.uuid,
  "rating_value" pg_catalog.numeric(9,4),
  "boolean_value" pg_catalog.bool,
  "text_value" pg_catalog.text,
  "answered_at" pg_catalog.timestamptz NOT NULL,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_mkt_survey_answer__survey_answer_id" PRIMARY KEY ("survey_answer_id"),
  CONSTRAINT "uq_mkt_survey_answer__survey_response_id__survey_que_6bf5cff4b9" UNIQUE ("survey_response_id", "survey_question_id", "value_index"),
  CONSTRAINT "ck_mkt_survey_answer__table__01" CHECK (pg_catalog.num_nonnulls ( "selected_option_id" , "rating_value" , "boolean_value" , "text_value" ) = 1),
  CONSTRAINT "ck_mkt_survey_answer__value_index__01" CHECK ("value_index" > 0)
);

CREATE TABLE public."mkt_survey_question" (
  "survey_question_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "campaign_version_id" pg_catalog.uuid NOT NULL,
  "question_code" pg_catalog.text NOT NULL,
  "question_text" pg_catalog.text NOT NULL,
  "question_type" pg_catalog.text NOT NULL,
  "sequence_no" pg_catalog.int4 NOT NULL,
  "is_required" pg_catalog.bool DEFAULT true NOT NULL,
  "validation_schema_version" pg_catalog.text DEFAULT 'survey-validation-v1' NOT NULL,
  "validation_rule" pg_catalog.jsonb DEFAULT '{}'::pg_catalog.jsonb NOT NULL,
  "created_by_user_id" pg_catalog.uuid,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_mkt_survey_question__survey_question_id" PRIMARY KEY ("survey_question_id"),
  CONSTRAINT "uq_mkt_survey_question__campaign_version_id__question_code" UNIQUE ("campaign_version_id", "question_code"),
  CONSTRAINT "uq_mkt_survey_question__campaign_version_id__sequence_no" UNIQUE ("campaign_version_id", "sequence_no"),
  CONSTRAINT "ck_mkt_survey_question__question_type__01" CHECK ("question_type" IN ( 'SINGLE_CHOICE' , 'MULTIPLE_CHOICE' , 'RATING' , 'TEXT' , 'BOOLEAN' )),
  CONSTRAINT "ck_mkt_survey_question__sequence_no__01" CHECK ("sequence_no" > 0)
);

CREATE TABLE public."mkt_survey_question_option" (
  "survey_question_option_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "survey_question_id" pg_catalog.uuid NOT NULL,
  "option_code" pg_catalog.text NOT NULL,
  "option_text" pg_catalog.text NOT NULL,
  "sequence_no" pg_catalog.int4 NOT NULL,
  "analysis_tags" pg_catalog.text[] DEFAULT '{}'::pg_catalog.text[] NOT NULL,
  "created_by_user_id" pg_catalog.uuid,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_mkt_survey_question_option__survey_question_option_id" PRIMARY KEY ("survey_question_option_id"),
  CONSTRAINT "uq_mkt_survey_question_option__survey_question_id__option_code" UNIQUE ("survey_question_id", "option_code"),
  CONSTRAINT "uq_mkt_survey_question_option__survey_question_id__sequence_no" UNIQUE ("survey_question_id", "sequence_no"),
  CONSTRAINT "ck_mkt_survey_question_option__sequence_no__01" CHECK ("sequence_no" > 0)
);

CREATE TABLE public."mkt_survey_response" (
  "survey_response_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "campaign_member_id" pg_catalog.uuid NOT NULL,
  "source_system_id" pg_catalog.uuid NOT NULL,
  "source_response_id" pg_catalog.text NOT NULL,
  "attempt_no" pg_catalog.int4,
  "started_at" pg_catalog.timestamptz,
  "submitted_at" pg_catalog.timestamptz,
  "status" pg_catalog.text NOT NULL,
  "validation_result" pg_catalog.jsonb DEFAULT '{}'::pg_catalog.jsonb NOT NULL,
  "client_context" pg_catalog.jsonb DEFAULT '{}'::pg_catalog.jsonb NOT NULL,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_mkt_survey_response__survey_response_id" PRIMARY KEY ("survey_response_id"),
  CONSTRAINT "uq_mkt_survey_response__campaign_member_id__attempt_no" UNIQUE NULLS NOT DISTINCT ("campaign_member_id", "attempt_no"),
  CONSTRAINT "uq_mkt_survey_response__source_system_id__source_response_id" UNIQUE ("source_system_id", "source_response_id"),
  CONSTRAINT "ck_mkt_survey_response__table__01" CHECK ("started_at" IS NOT NULL OR ( "submitted_at" IS NOT NULL AND "status" IN ( 'SUBMITTED' , 'VALIDATED' , 'REJECTED' ) )),
  CONSTRAINT "ck_mkt_survey_response__attempt_no__01" CHECK ("attempt_no" IS NULL OR "attempt_no" > 0),
  CONSTRAINT "ck_mkt_survey_response__status__01" CHECK ("status" IN ( 'IN_PROGRESS' , 'SUBMITTED' , 'VALIDATED' , 'REJECTED' , 'ABANDONED' ))
);

CREATE TABLE public."mkt_survey_result" (
  "survey_result_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "survey_response_id" pg_catalog.uuid NOT NULL,
  "result_type" pg_catalog.text NOT NULL,
  "result_code" pg_catalog.text NOT NULL,
  "result_label" pg_catalog.text,
  "result_color" pg_catalog.text,
  "algorithm_version" pg_catalog.text NOT NULL,
  "input_sha256" pg_catalog.bpchar(64),
  "result_dimensions" pg_catalog.jsonb DEFAULT '{}'::pg_catalog.jsonb NOT NULL,
  "quality_status" pg_catalog.text NOT NULL,
  "calculated_at" pg_catalog.timestamptz NOT NULL,
  "source_system_id" pg_catalog.uuid,
  "source_result_id" pg_catalog.text,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_mkt_survey_result__survey_result_id" PRIMARY KEY ("survey_result_id"),
  CONSTRAINT "uq_mkt_survey_result__survey_response_id__result_typ_07b177b353" UNIQUE ("survey_response_id", "result_type", "algorithm_version"),
  CONSTRAINT "uq_mkt_survey_result__source_system_id__source_result_id" UNIQUE NULLS DISTINCT ("source_system_id", "source_result_id"),
  CONSTRAINT "ck_mkt_survey_result__table__01" CHECK (( "source_system_id" IS NULL ) = ( "source_result_id" IS NULL )),
  CONSTRAINT "ck_mkt_survey_result__table__02" CHECK ("input_sha256" IS NOT NULL OR "quality_status" = 'INCOMPLETE_INPUT'),
  CONSTRAINT "ck_mkt_survey_result__quality_status__01" CHECK ("quality_status" IN ( 'VALID' , 'INCOMPLETE_INPUT' , 'ALGORITHM_ERROR' , 'REJECTED' ))
);
