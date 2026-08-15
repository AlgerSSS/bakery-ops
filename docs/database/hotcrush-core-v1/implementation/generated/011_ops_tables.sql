-- HOT CRUSH Core V1 R6 / ops physical tables
-- Generated deterministically. Do not hand-edit.
-- The psycopg2 apply runner owns the sole transaction, lock and SET LOCAL state.

CREATE TABLE public."ops_business_rule" (
  "business_rule_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "scope_location_id" pg_catalog.uuid,
  "scope_product_id" pg_catalog.uuid,
  "rule_code" pg_catalog.text NOT NULL,
  "version_no" pg_catalog.int4 NOT NULL,
  "rule_value" pg_catalog.jsonb NOT NULL,
  "schema_version" pg_catalog.text NOT NULL,
  "valid_from" pg_catalog.timestamptz NOT NULL,
  "valid_to" pg_catalog.timestamptz,
  "status" pg_catalog.text NOT NULL,
  "approved_by_user_id" pg_catalog.uuid,
  "created_by_user_id" pg_catalog.uuid,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_ops_business_rule__business_rule_id" PRIMARY KEY ("business_rule_id"),
  CONSTRAINT "uq_ops_business_rule__scope_location_id__scope_produ_8fb6f33ce5" UNIQUE NULLS NOT DISTINCT ("scope_location_id", "scope_product_id", "rule_code", "version_no"),
  CONSTRAINT "ck_ops_business_rule__table__01" CHECK ("valid_to" IS NULL OR "valid_to" > "valid_from"),
  CONSTRAINT "ck_ops_business_rule__version_no__01" CHECK ("version_no" > 0),
  CONSTRAINT "ck_ops_business_rule__status__01" CHECK ("status" IN ( 'DRAFT' , 'APPROVED' , 'ACTIVE' , 'RETIRED' )),
  CONSTRAINT "ex_ops_business_rule__active_period" EXCLUDE USING gist (
      COALESCE("scope_location_id", '00000000-0000-0000-0000-000000000000'::pg_catalog.uuid) WITH =,
      COALESCE("scope_product_id", '00000000-0000-0000-0000-000000000000'::pg_catalog.uuid) WITH =,
      "rule_code" WITH =,
      pg_catalog.tstzrange("valid_from", "valid_to", '[)') WITH &&
    ) WHERE ("status" = 'ACTIVE') DEFERRABLE INITIALLY IMMEDIATE
);

CREATE TABLE public."ops_calendar_event" (
  "calendar_event_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "job_run_id" pg_catalog.uuid NOT NULL,
  "jurisdiction_code" pg_catalog.text NOT NULL,
  "event_date" pg_catalog.date NOT NULL,
  "event_type" pg_catalog.text NOT NULL,
  "event_code" pg_catalog.text,
  "event_name" pg_catalog.text NOT NULL,
  "is_paid_holiday" pg_catalog.bool,
  "status" pg_catalog.text DEFAULT 'ACTIVE' NOT NULL,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_ops_calendar_event__calendar_event_id" PRIMARY KEY ("calendar_event_id"),
  CONSTRAINT "uq_ops_calendar_event__job_run_id__jurisdiction_code_577e6a4fd1" UNIQUE ("job_run_id", "jurisdiction_code", "event_date", "event_name"),
  CONSTRAINT "ck_ops_calendar_event__event_type__01" CHECK ("event_type" IN ( 'PUBLIC_HOLIDAY' , 'SCHOOL_HOLIDAY' , 'EVENT' , 'CLOSURE' )),
  CONSTRAINT "ck_ops_calendar_event__status__01" CHECK ("status" IN ( 'ACTIVE' , 'CANCELLED' , 'SUPERSEDED' ))
);

CREATE TABLE public."ops_daily_review" (
  "daily_review_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "location_id" pg_catalog.uuid NOT NULL,
  "business_date" pg_catalog.date NOT NULL,
  "version_no" pg_catalog.int4 NOT NULL,
  "ai_call_id" pg_catalog.uuid,
  "manager_revenue" pg_catalog.numeric(18,4),
  "manager_transaction_count" pg_catalog.int4,
  "manager_avg_transaction" pg_catalog.numeric(18,4),
  "manager_avg_transaction_source" pg_catalog.text,
  "manager_revenue_at" pg_catalog.timestamptz,
  "manager_currency" pg_catalog.bpchar(3) DEFAULT 'MYR' NOT NULL,
  "manager_input_schema_version" pg_catalog.text DEFAULT 'daily-review-manager-v1' NOT NULL,
  "manager_input" pg_catalog.jsonb DEFAULT '{}'::pg_catalog.jsonb NOT NULL,
  "review_summary_schema_version" pg_catalog.text DEFAULT 'daily-review-summary-v1' NOT NULL,
  "review_summary" pg_catalog.jsonb NOT NULL,
  "status" pg_catalog.text NOT NULL,
  "approved_by_user_id" pg_catalog.uuid,
  "approved_at" pg_catalog.timestamptz,
  "created_by_user_id" pg_catalog.uuid,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_ops_daily_review__daily_review_id" PRIMARY KEY ("daily_review_id"),
  CONSTRAINT "uq_ops_daily_review__location_id__business_date__version_no" UNIQUE ("location_id", "business_date", "version_no"),
  CONSTRAINT "ck_ops_daily_review__table__01" CHECK (( "manager_avg_transaction" IS NULL AND "manager_avg_transaction_source" IS NULL ) OR ( "manager_avg_transaction" IS NOT NULL AND "manager_avg_transaction_source" IS NOT NULL )),
  CONSTRAINT "ck_ops_daily_review__version_no__01" CHECK ("version_no" > 0),
  CONSTRAINT "ck_ops_daily_review__manager_revenue__01" CHECK ("manager_revenue" IS NULL OR "manager_revenue" >= 0),
  CONSTRAINT "ck_ops_daily_review__manager_transaction_count__01" CHECK ("manager_transaction_count" IS NULL OR "manager_transaction_count" >= 0),
  CONSTRAINT "ck_ops_daily_review__manager_avg_transaction__01" CHECK ("manager_avg_transaction" IS NULL OR "manager_avg_transaction" >= 0),
  CONSTRAINT "ck_ops_daily_review__manager_avg_transaction_source__01" CHECK ("manager_avg_transaction_source" IS NULL OR "manager_avg_transaction_source" IN ( 'INDEPENDENT_MANAGER_REPORT' , 'INDEPENDENT_SOURCE_REPORT' , 'MIGRATED_LEGACY' )),
  CONSTRAINT "ck_ops_daily_review__status__01" CHECK ("status" IN ( 'DRAFT' , 'SUBMITTED' , 'APPROVED' , 'SUPERSEDED' ))
);

CREATE TABLE public."ops_forecast_line" (
  "forecast_line_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "forecast_run_id" pg_catalog.uuid NOT NULL,
  "product_id" pg_catalog.uuid NOT NULL,
  "forecast_quantity" pg_catalog.numeric(18,4) NOT NULL,
  "lower_bound" pg_catalog.numeric(18,4),
  "upper_bound" pg_catalog.numeric(18,4),
  "model_explanation" pg_catalog.jsonb DEFAULT '{}'::pg_catalog.jsonb NOT NULL,
  "quality_status" pg_catalog.text DEFAULT 'COMPLETE' NOT NULL,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_ops_forecast_line__forecast_line_id" PRIMARY KEY ("forecast_line_id"),
  CONSTRAINT "uq_ops_forecast_line__forecast_run_id__product_id" UNIQUE ("forecast_run_id", "product_id"),
  CONSTRAINT "ck_ops_forecast_line__table__01" CHECK ("lower_bound" IS NULL OR "lower_bound" >= 0),
  CONSTRAINT "ck_ops_forecast_line__table__02" CHECK ("upper_bound" IS NULL OR "upper_bound" >= "forecast_quantity"),
  CONSTRAINT "ck_ops_forecast_line__forecast_quantity__01" CHECK ("forecast_quantity" >= 0),
  CONSTRAINT "ck_ops_forecast_line__quality_status__01" CHECK ("quality_status" IN ( 'COMPLETE' , 'LOW_HISTORY' , 'UNMAPPED_INPUT' , 'REJECTED' ))
);

CREATE TABLE public."ops_forecast_run" (
  "forecast_run_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "job_run_id" pg_catalog.uuid NOT NULL,
  "location_id" pg_catalog.uuid NOT NULL,
  "target_business_date" pg_catalog.date NOT NULL,
  "algorithm_version" pg_catalog.text NOT NULL,
  "input_manifest" pg_catalog.jsonb NOT NULL,
  "status" pg_catalog.text NOT NULL,
  "started_at" pg_catalog.timestamptz NOT NULL,
  "completed_at" pg_catalog.timestamptz,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_ops_forecast_run__forecast_run_id" PRIMARY KEY ("forecast_run_id"),
  CONSTRAINT "ck_ops_forecast_run__status__01" CHECK ("status" IN ( 'RUNNING' , 'SUCCEEDED' , 'PARTIAL' , 'FAILED' , 'REJECTED' ))
);

CREATE TABLE public."ops_location" (
  "location_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "parent_location_id" pg_catalog.uuid,
  "location_code" pg_catalog.text NOT NULL,
  "location_name" pg_catalog.text NOT NULL,
  "address_text" pg_catalog.text,
  "area_code" pg_catalog.text,
  "location_type" pg_catalog.text NOT NULL,
  "country_code" pg_catalog.bpchar(2) DEFAULT 'MY' NOT NULL,
  "timezone_name" pg_catalog.text DEFAULT 'Asia/Kuala_Lumpur' NOT NULL,
  "default_currency" pg_catalog.bpchar(3) DEFAULT 'MYR' NOT NULL,
  "business_day_cutoff" pg_catalog.time DEFAULT '04:00:00' NOT NULL,
  "status" pg_catalog.text DEFAULT 'ACTIVE' NOT NULL,
  "opened_on" pg_catalog.date,
  "closed_on" pg_catalog.date,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_ops_location__location_id" PRIMARY KEY ("location_id"),
  CONSTRAINT "uq_ops_location__location_code" UNIQUE ("location_code"),
  CONSTRAINT "ck_ops_location__table__01" CHECK ("closed_on" IS NULL OR "opened_on" IS NULL OR "closed_on" >= "opened_on"),
  CONSTRAINT "ck_ops_location__table__02" CHECK ("location_id" <> '00000000-0000-0000-0000-000000000000'),
  CONSTRAINT "ck_ops_location__area_code__01" CHECK ("area_code" IS NULL OR "area_code" ~ '^[A-Z][A-Z0-9_-]{1,63}$'),
  CONSTRAINT "ck_ops_location__location_type__01" CHECK ("location_type" IN ( 'STORE' , 'KITCHEN' , 'WAREHOUSE' , 'OFFICE' , 'HYBRID' )),
  CONSTRAINT "ck_ops_location__status__01" CHECK ("status" IN ( 'PLANNED' , 'ACTIVE' , 'SUSPENDED' , 'CLOSED' ))
);

CREATE TABLE public."ops_location_source_identity" (
  "location_source_identity_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "location_id" pg_catalog.uuid NOT NULL,
  "source_system_id" pg_catalog.uuid NOT NULL,
  "source_container_id" pg_catalog.text,
  "source_location_id" pg_catalog.text NOT NULL,
  "source_location_name" pg_catalog.text,
  "valid_from" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "valid_to" pg_catalog.timestamptz,
  "mapping_status" pg_catalog.text DEFAULT 'PENDING' NOT NULL,
  "evidence" pg_catalog.jsonb DEFAULT '{}'::pg_catalog.jsonb NOT NULL,
  "created_by_user_id" pg_catalog.uuid,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_ops_location_source_identity__location_source_identity_id" PRIMARY KEY ("location_source_identity_id"),
  CONSTRAINT "uq_ops_location_source_identity__source_system_id__s_0293074e34" UNIQUE NULLS NOT DISTINCT ("source_system_id", "source_container_id", "source_location_id", "valid_from"),
  CONSTRAINT "ck_ops_location_source_identity__table__01" CHECK ("valid_to" IS NULL OR "valid_to" > "valid_from"),
  CONSTRAINT "ck_ops_location_source_identity__table__02" CHECK ("source_container_id" IS NULL OR "source_container_id" <> ''),
  CONSTRAINT "ck_ops_location_source_identity__mapping_status__01" CHECK ("mapping_status" IN ( 'CONFIRMED' , 'PENDING' , 'REJECTED' )),
  CONSTRAINT "ex_ops_location_source_identity__confirmed_period" EXCLUDE USING gist (
      "source_system_id" WITH =,
      COALESCE("source_container_id", ''::pg_catalog.text) WITH =,
      "source_location_id" WITH =,
      pg_catalog.tstzrange("valid_from", "valid_to", '[)') WITH &&
    ) WHERE ("mapping_status" = 'CONFIRMED') DEFERRABLE INITIALLY IMMEDIATE
);

CREATE TABLE public."ops_operational_event" (
  "operational_event_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "location_id" pg_catalog.uuid NOT NULL,
  "event_type" pg_catalog.text NOT NULL,
  "event_title" pg_catalog.text NOT NULL,
  "started_at" pg_catalog.timestamptz NOT NULL,
  "ended_at" pg_catalog.timestamptz,
  "impact_direction" pg_catalog.text NOT NULL,
  "impact_summary" pg_catalog.text NOT NULL,
  "evidence" pg_catalog.jsonb DEFAULT '{}'::pg_catalog.jsonb NOT NULL,
  "status" pg_catalog.text DEFAULT 'OPEN' NOT NULL,
  "created_by_user_id" pg_catalog.uuid,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_ops_operational_event__operational_event_id" PRIMARY KEY ("operational_event_id"),
  CONSTRAINT "ck_ops_operational_event__table__01" CHECK ("ended_at" IS NULL OR "ended_at" > "started_at"),
  CONSTRAINT "ck_ops_operational_event__event_type__01" CHECK ("event_type" IN ( 'POWER_OUTAGE' , 'EQUIPMENT_FAILURE' , 'PROMOTION' , 'FOOTFALL_SURGE' , 'STAFF_SHORTAGE' , 'OTHER' )),
  CONSTRAINT "ck_ops_operational_event__impact_direction__01" CHECK ("impact_direction" IN ( 'INCREASE' , 'DECREASE' , 'MIXED' , 'UNKNOWN' )),
  CONSTRAINT "ck_ops_operational_event__status__01" CHECK ("status" IN ( 'OPEN' , 'CONFIRMED' , 'RESOLVED' , 'REJECTED' ))
);

CREATE TABLE public."ops_operational_event_product" (
  "operational_event_product_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "operational_event_id" pg_catalog.uuid NOT NULL,
  "product_id" pg_catalog.uuid NOT NULL,
  "impact_direction" pg_catalog.text NOT NULL,
  "estimated_quantity_impact" pg_catalog.numeric(18,4),
  "note" pg_catalog.text,
  "created_by_user_id" pg_catalog.uuid,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_ops_operational_event_product__operational_event_product_id" PRIMARY KEY ("operational_event_product_id"),
  CONSTRAINT "uq_ops_operational_event_product__operational_event__ebcc092383" UNIQUE ("operational_event_id", "product_id"),
  CONSTRAINT "ck_ops_operational_event_product__impact_direction__01" CHECK ("impact_direction" IN ( 'INCREASE' , 'DECREASE' , 'UNAVAILABLE' , 'UNKNOWN' ))
);

CREATE TABLE public."ops_product" (
  "product_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "product_code" pg_catalog.text NOT NULL,
  "product_name" pg_catalog.text NOT NULL,
  "english_name" pg_catalog.text,
  "product_type" pg_catalog.text NOT NULL,
  "category_code" pg_catalog.text NOT NULL,
  "base_unit_id" pg_catalog.uuid NOT NULL,
  "pack_multiple" pg_catalog.numeric(18,4) DEFAULT 1 NOT NULL,
  "planning_rounding_mode" pg_catalog.text DEFAULT 'BATCH_MULTIPLE' NOT NULL,
  "temperature_profile_code" pg_catalog.text,
  "is_production_planned" pg_catalog.bool DEFAULT false NOT NULL,
  "is_inventory_tracked" pg_catalog.bool DEFAULT false NOT NULL,
  "status" pg_catalog.text DEFAULT 'DRAFT' NOT NULL,
  "created_by_user_id" pg_catalog.uuid,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_ops_product__product_id" PRIMARY KEY ("product_id"),
  CONSTRAINT "uq_ops_product__product_code" UNIQUE ("product_code"),
  CONSTRAINT "ck_ops_product__table__01" CHECK ("product_id" <> '00000000-0000-0000-0000-000000000000'),
  CONSTRAINT "ck_ops_product__product_type__01" CHECK ("product_type" IN ( 'SELLABLE' , 'PRODUCED' , 'SERVICE' , 'BUNDLE' )),
  CONSTRAINT "ck_ops_product__category_code__01" CHECK ("category_code" ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  CONSTRAINT "ck_ops_product__pack_multiple__01" CHECK ("pack_multiple" > 0),
  CONSTRAINT "ck_ops_product__planning_rounding_mode__01" CHECK ("planning_rounding_mode" IN ( 'BATCH_MULTIPLE' , 'INDIVIDUAL' )),
  CONSTRAINT "ck_ops_product__temperature_profile_code__01" CHECK ("temperature_profile_code" IS NULL OR "temperature_profile_code" IN ( 'HOT' , 'COLD' , 'AMBIENT' , 'MIXED' )),
  CONSTRAINT "ck_ops_product__status__01" CHECK ("status" IN ( 'DRAFT' , 'ACTIVE' , 'SUSPENDED' , 'RETIRED' ))
);

CREATE TABLE public."ops_product_alias" (
  "product_alias_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "product_id" pg_catalog.uuid NOT NULL,
  "source_system_id" pg_catalog.uuid,
  "alias_text" pg_catalog.text NOT NULL,
  "language_code" pg_catalog.text,
  "valid_from" pg_catalog.date DEFAULT CURRENT_DATE NOT NULL,
  "valid_to" pg_catalog.date,
  "status" pg_catalog.text DEFAULT 'PENDING' NOT NULL,
  "created_by_user_id" pg_catalog.uuid,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_ops_product_alias__product_alias_id" PRIMARY KEY ("product_alias_id"),
  CONSTRAINT "uq_ops_product_alias__source_system_id__alias_text__valid_from" UNIQUE NULLS NOT DISTINCT ("source_system_id", "alias_text", "valid_from"),
  CONSTRAINT "ck_ops_product_alias__table__01" CHECK ("valid_to" IS NULL OR "valid_to" > "valid_from"),
  CONSTRAINT "ck_ops_product_alias__table__02" CHECK (public.app_normalize_alias_v1 ( "alias_text" ) <> ''),
  CONSTRAINT "ck_ops_product_alias__status__01" CHECK ("status" IN ( 'CONFIRMED' , 'PENDING' , 'REJECTED' )),
  CONSTRAINT "ex_ops_product_alias__confirmed_period" EXCLUDE USING gist (
      COALESCE("source_system_id", '00000000-0000-0000-0000-000000000000'::pg_catalog.uuid) WITH =,
      public.app_normalize_alias_v1("alias_text") WITH =,
      pg_catalog.daterange("valid_from", "valid_to", '[)') WITH &&
    ) WHERE ("status" = 'CONFIRMED') DEFERRABLE INITIALLY IMMEDIATE
);

CREATE TABLE public."ops_production_plan_line" (
  "production_plan_line_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "production_plan_version_id" pg_catalog.uuid NOT NULL,
  "product_id" pg_catalog.uuid NOT NULL,
  "forecast_line_id" pg_catalog.uuid,
  "based_on_plan_line_id" pg_catalog.uuid,
  "planned_quantity" pg_catalog.numeric(18,4) NOT NULL,
  "unit_id" pg_catalog.uuid NOT NULL,
  "adjustment_reason_code" pg_catalog.text,
  "adjustment_note" pg_catalog.text,
  "suggested_by_ai_call_id" pg_catalog.uuid,
  "confirmed_by_user_id" pg_catalog.uuid,
  "note" pg_catalog.text,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_ops_production_plan_line__production_plan_line_id" PRIMARY KEY ("production_plan_line_id"),
  CONSTRAINT "uq_ops_production_plan_line__production_plan_version_f5690ff42f" UNIQUE ("production_plan_version_id", "product_id"),
  CONSTRAINT "ck_ops_production_plan_line__planned_quantity__01" CHECK ("planned_quantity" >= 0)
);

CREATE TABLE public."ops_production_plan_version" (
  "production_plan_version_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "location_id" pg_catalog.uuid NOT NULL,
  "plan_business_date" pg_catalog.date NOT NULL,
  "forecast_run_id" pg_catalog.uuid,
  "based_on_version_id" pg_catalog.uuid,
  "version_no" pg_catalog.int4 NOT NULL,
  "status" pg_catalog.text NOT NULL,
  "change_summary" pg_catalog.text,
  "approved_at" pg_catalog.timestamptz,
  "approved_by_user_id" pg_catalog.uuid,
  "published_at" pg_catalog.timestamptz,
  "created_by_user_id" pg_catalog.uuid,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_ops_production_plan_version__production_plan_version_id" PRIMARY KEY ("production_plan_version_id"),
  CONSTRAINT "uq_ops_production_plan_version__location_id__plan_bu_1517049344" UNIQUE ("location_id", "plan_business_date", "version_no"),
  CONSTRAINT "ck_ops_production_plan_version__version_no__01" CHECK ("version_no" > 0),
  CONSTRAINT "ck_ops_production_plan_version__status__01" CHECK ("status" IN ( 'DRAFT' , 'SUBMITTED' , 'APPROVED' , 'PUBLISHED' , 'SUPERSEDED' , 'REJECTED' , 'CANCELLED' ))
);

CREATE TABLE public."ops_review_action" (
  "review_action_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "daily_review_id" pg_catalog.uuid NOT NULL,
  "action_type" pg_catalog.text NOT NULL,
  "action_description" pg_catalog.text NOT NULL,
  "owner_employment_id" pg_catalog.uuid,
  "due_at" pg_catalog.timestamptz,
  "status" pg_catalog.text DEFAULT 'OPEN' NOT NULL,
  "completed_at" pg_catalog.timestamptz,
  "completion_evidence" pg_catalog.jsonb DEFAULT '{}'::pg_catalog.jsonb NOT NULL,
  "created_by_user_id" pg_catalog.uuid,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_ops_review_action__review_action_id" PRIMARY KEY ("review_action_id"),
  CONSTRAINT "ck_ops_review_action__action_type__01" CHECK ("action_type" IN ( 'PLAN_ADJUSTMENT' , 'TRAINING' , 'MAINTENANCE' , 'SUPPLY' , 'STAFFING' , 'OTHER' )),
  CONSTRAINT "ck_ops_review_action__status__01" CHECK ("status" IN ( 'OPEN' , 'IN_PROGRESS' , 'COMPLETED' , 'CANCELLED' , 'REJECTED' ))
);

CREATE TABLE public."ops_role" (
  "role_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "role_code" pg_catalog.text NOT NULL,
  "role_name" pg_catalog.text NOT NULL,
  "role_family" pg_catalog.text NOT NULL,
  "is_critical" pg_catalog.bool DEFAULT false NOT NULL,
  "status" pg_catalog.text DEFAULT 'ACTIVE' NOT NULL,
  "created_by_user_id" pg_catalog.uuid,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_ops_role__role_id" PRIMARY KEY ("role_id"),
  CONSTRAINT "uq_ops_role__role_code" UNIQUE ("role_code"),
  CONSTRAINT "ck_ops_role__role_family__01" CHECK ("role_family" IN ( 'KITCHEN' , 'FRONT' , 'LOGISTICS' , 'MANAGEMENT' , 'SUPPORT' )),
  CONSTRAINT "ck_ops_role__status__01" CHECK ("status" IN ( 'ACTIVE' , 'RETIRED' ))
);

CREATE TABLE public."ops_stockout_event" (
  "stockout_event_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "location_id" pg_catalog.uuid NOT NULL,
  "listing_id" pg_catalog.uuid NOT NULL,
  "detected_job_run_id" pg_catalog.uuid,
  "business_date" pg_catalog.date NOT NULL,
  "started_at" pg_catalog.timestamptz NOT NULL,
  "ended_at" pg_catalog.timestamptz,
  "detection_method" pg_catalog.text NOT NULL,
  "lost_quantity_estimate" pg_catalog.numeric(18,4),
  "lost_sales_estimate" pg_catalog.numeric(18,4),
  "currency" pg_catalog.bpchar(3) DEFAULT 'MYR' NOT NULL,
  "estimation_version" pg_catalog.text,
  "evidence" pg_catalog.jsonb DEFAULT '{}'::pg_catalog.jsonb NOT NULL,
  "status" pg_catalog.text DEFAULT 'DETECTED' NOT NULL,
  "created_by_user_id" pg_catalog.uuid,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_ops_stockout_event__stockout_event_id" PRIMARY KEY ("stockout_event_id"),
  CONSTRAINT "ck_ops_stockout_event__table__01" CHECK ("ended_at" IS NULL OR "ended_at" > "started_at"),
  CONSTRAINT "ck_ops_stockout_event__detection_method__01" CHECK ("detection_method" IN ( 'AUTOMATIC' , 'MANUAL' , 'CONFIRMED_AUTOMATIC' )),
  CONSTRAINT "ck_ops_stockout_event__status__01" CHECK ("status" IN ( 'DETECTED' , 'CONFIRMED' , 'REJECTED' , 'CLOSED' )),
  CONSTRAINT "ex_ops_stockout_event__live_period" EXCLUDE USING gist (
      "location_id" WITH =,
      "listing_id" WITH =,
      pg_catalog.tstzrange("started_at", "ended_at", '[)') WITH &&
    ) WHERE ("status" IN ('DETECTED', 'CONFIRMED', 'CLOSED')) DEFERRABLE INITIALLY IMMEDIATE
);
