-- HOT CRUSH Core V1 R6 / app physical tables
-- Generated deterministically. Do not hand-edit.
-- The psycopg2 apply runner owns the sole transaction, lock and SET LOCAL state.

CREATE TABLE public."app_audit_event" (
  "audit_event_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "actor_user_id" pg_catalog.uuid,
  "job_run_id" pg_catalog.uuid,
  "actor_type" pg_catalog.text NOT NULL,
  "action_code" pg_catalog.text NOT NULL,
  "object_type" pg_catalog.text NOT NULL,
  "object_id" pg_catalog.uuid,
  "request_id" pg_catalog.text,
  "result" pg_catalog.text NOT NULL,
  "before_data" pg_catalog.jsonb,
  "after_data" pg_catalog.jsonb,
  "ip_address" pg_catalog.inet,
  "user_agent" pg_catalog.text,
  "occurred_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_app_audit_event__audit_event_id" PRIMARY KEY ("audit_event_id"),
  CONSTRAINT "ck_app_audit_event__actor_type__01" CHECK ("actor_type" IN ( 'USER' , 'SERVICE' , 'DATABASE' )),
  CONSTRAINT "ck_app_audit_event__action_code__01" CHECK ("action_code" ~ '^[A-Z][A-Z0-9_]{2,95}$'),
  CONSTRAINT "ck_app_audit_event__object_type__01" CHECK ("object_type" ~ '^(app|ops|pos|hr|scm|cost_card|finance|mkt|msg|ai)_[a-z0-9_]+$'),
  CONSTRAINT "ck_app_audit_event__result__01" CHECK ("result" IN ( 'SUCCESS' , 'DENIED' , 'FAILED' ))
);

CREATE TABLE public."app_job_run" (
  "job_run_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "source_system_id" pg_catalog.uuid,
  "job_code" pg_catalog.text NOT NULL,
  "scheduled_for" pg_catalog.timestamptz,
  "started_at" pg_catalog.timestamptz NOT NULL,
  "finished_at" pg_catalog.timestamptz,
  "status" pg_catalog.text NOT NULL,
  "input_manifest" pg_catalog.jsonb DEFAULT '{}'::pg_catalog.jsonb NOT NULL,
  "row_count" pg_catalog.int8,
  "error_code" pg_catalog.text,
  "error_detail" pg_catalog.text,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_app_job_run__job_run_id" PRIMARY KEY ("job_run_id"),
  CONSTRAINT "ck_app_job_run__status__01" CHECK ("status" IN ( 'QUEUED' , 'RUNNING' , 'SUCCEEDED' , 'FAILED' , 'PARTIAL' , 'CANCELLED' )),
  CONSTRAINT "ck_app_job_run__row_count__01" CHECK ("row_count" IS NULL OR "row_count" >= 0)
);

CREATE TABLE public."app_one_time_token" (
  "one_time_token_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "token_purpose" pg_catalog.text NOT NULL,
  "user_id" pg_catalog.uuid,
  "member_id" pg_catalog.uuid,
  "campaign_member_id" pg_catalog.uuid,
  "application_id" pg_catalog.uuid,
  "token_hash" pg_catalog.bpchar(64) NOT NULL,
  "expires_at" pg_catalog.timestamptz NOT NULL,
  "consumed_at" pg_catalog.timestamptz,
  "revoked_at" pg_catalog.timestamptz,
  "return_route_code" pg_catalog.text,
  "metadata" pg_catalog.jsonb DEFAULT '{}'::pg_catalog.jsonb NOT NULL,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_app_one_time_token__one_time_token_id" PRIMARY KEY ("one_time_token_id"),
  CONSTRAINT "uq_app_one_time_token__token_hash" UNIQUE ("token_hash"),
  CONSTRAINT "ck_app_one_time_token__table__01" CHECK (pg_catalog.num_nonnulls ( "user_id" , "member_id" , "campaign_member_id" , "application_id" ) = 1),
  CONSTRAINT "ck_app_one_time_token__table__02" CHECK ("consumed_at" IS NULL OR "revoked_at" IS NULL),
  CONSTRAINT "ck_app_one_time_token__token_purpose__01" CHECK (pg_catalog.length ( "token_purpose" ) > 0)
);

CREATE TABLE public."app_rate_limit_event" (
  "rate_limit_event_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "scope_code" pg_catalog.text NOT NULL,
  "key_hash" pg_catalog.bpchar(64) NOT NULL,
  "window_started_at" pg_catalog.timestamptz NOT NULL,
  "window_seconds" pg_catalog.int4 NOT NULL,
  "request_count" pg_catalog.int4 DEFAULT 1 NOT NULL,
  "blocked_count" pg_catalog.int4 DEFAULT 0 NOT NULL,
  "expires_at" pg_catalog.timestamptz NOT NULL,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_app_rate_limit_event__rate_limit_event_id" PRIMARY KEY ("rate_limit_event_id"),
  CONSTRAINT "uq_app_rate_limit_event__scope_code__key_hash__windo_5119d6a279" UNIQUE ("scope_code", "key_hash", "window_started_at", "window_seconds"),
  CONSTRAINT "ck_app_rate_limit_event__window_seconds__01" CHECK ("window_seconds" > 0),
  CONSTRAINT "ck_app_rate_limit_event__request_count__01" CHECK ("request_count" >= 0),
  CONSTRAINT "ck_app_rate_limit_event__blocked_count__01" CHECK ("blocked_count" >= 0)
);

CREATE TABLE public."app_role" (
  "role_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "role_code" pg_catalog.text NOT NULL,
  "role_name" pg_catalog.text NOT NULL,
  "description" pg_catalog.text NOT NULL,
  "status" pg_catalog.text DEFAULT 'ACTIVE' NOT NULL,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_app_role__role_id" PRIMARY KEY ("role_id"),
  CONSTRAINT "uq_app_role__role_code" UNIQUE ("role_code"),
  CONSTRAINT "ck_app_role__status__01" CHECK ("status" IN ( 'ACTIVE' , 'RETIRED' ))
);

CREATE TABLE public."app_schema_migration" (
  "migration_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "repository_code" pg_catalog.text NOT NULL,
  "migration_version" pg_catalog.text NOT NULL,
  "migration_name" pg_catalog.text,
  "filename" pg_catalog.text NOT NULL,
  "checksum_sha256" pg_catalog.bpchar(64) NOT NULL,
  "applied_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "applied_by" pg_catalog.text NOT NULL,
  "execution_ms" pg_catalog.int4,
  CONSTRAINT "pk_app_schema_migration__migration_id" PRIMARY KEY ("migration_id"),
  CONSTRAINT "uq_app_schema_migration__repository_code__migration_version" UNIQUE ("repository_code", "migration_version"),
  CONSTRAINT "ck_app_schema_migration__table__01" CHECK ("execution_ms" IS NULL OR "execution_ms" >= 0)
);

CREATE TABLE public."app_session" (
  "session_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "user_id" pg_catalog.uuid NOT NULL,
  "token_hash" pg_catalog.bpchar(64) NOT NULL,
  "issued_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "expires_at" pg_catalog.timestamptz NOT NULL,
  "revoked_at" pg_catalog.timestamptz,
  "ip_address" pg_catalog.inet,
  "user_agent" pg_catalog.text,
  CONSTRAINT "pk_app_session__session_id" PRIMARY KEY ("session_id"),
  CONSTRAINT "uq_app_session__token_hash" UNIQUE ("token_hash"),
  CONSTRAINT "ck_app_session__table__01" CHECK ("expires_at" > "issued_at")
);

CREATE TABLE public."app_source_system" (
  "source_system_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "source_code" pg_catalog.text NOT NULL,
  "source_name" pg_catalog.text NOT NULL,
  "source_type" pg_catalog.text NOT NULL,
  "owner_project" pg_catalog.text NOT NULL,
  "authoritative_scope" pg_catalog.text NOT NULL,
  "status" pg_catalog.text DEFAULT 'ACTIVE' NOT NULL,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_app_source_system__source_system_id" PRIMARY KEY ("source_system_id"),
  CONSTRAINT "uq_app_source_system__source_code" UNIQUE ("source_code"),
  CONSTRAINT "ck_app_source_system__table__01" CHECK ("source_system_id" <> '00000000-0000-0000-0000-000000000000'),
  CONSTRAINT "ck_app_source_system__source_type__01" CHECK ("source_type" IN ( 'API' , 'FILE' , 'MANUAL' , 'DATABASE' , 'GENERATED' )),
  CONSTRAINT "ck_app_source_system__status__01" CHECK ("status" IN ( 'ACTIVE' , 'PAUSED' , 'RETIRED' ))
);

CREATE TABLE public."app_unit" (
  "unit_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "unit_code" pg_catalog.text NOT NULL,
  "unit_name" pg_catalog.text NOT NULL,
  "dimension_code" pg_catalog.text NOT NULL,
  "canonical_unit_id" pg_catalog.uuid,
  "factor_to_canonical" pg_catalog.numeric(24,12),
  "decimal_scale" pg_catalog.int2 DEFAULT 3 NOT NULL,
  "status" pg_catalog.text DEFAULT 'ACTIVE' NOT NULL,
  "created_by_user_id" pg_catalog.uuid,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_app_unit__unit_id" PRIMARY KEY ("unit_id"),
  CONSTRAINT "uq_app_unit__unit_code" UNIQUE ("unit_code"),
  CONSTRAINT "ck_app_unit__table__01" CHECK ("canonical_unit_id" IS NULL OR "canonical_unit_id" <> "unit_id"),
  CONSTRAINT "ck_app_unit__dimension_code__01" CHECK ("dimension_code" IN ( 'MASS' , 'VOLUME' , 'COUNT' , 'LENGTH' , 'PACKAGING' , 'OTHER' )),
  CONSTRAINT "ck_app_unit__factor_to_canonical__01" CHECK ("factor_to_canonical" IS NULL OR "factor_to_canonical" > 0),
  CONSTRAINT "ck_app_unit__decimal_scale__01" CHECK ("decimal_scale" BETWEEN 0 AND 12),
  CONSTRAINT "ck_app_unit__status__01" CHECK ("status" IN ( 'ACTIVE' , 'RETIRED' ))
);

CREATE TABLE public."app_user" (
  "user_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "person_id" pg_catalog.uuid,
  "username" extensions.citext NOT NULL,
  "display_name" pg_catalog.text NOT NULL,
  "password_hash" pg_catalog.text,
  "account_type" pg_catalog.text NOT NULL,
  "status" pg_catalog.text DEFAULT 'ACTIVE' NOT NULL,
  "must_change_password" pg_catalog.bool DEFAULT false NOT NULL,
  "failed_login_count" pg_catalog.int4 DEFAULT 0 NOT NULL,
  "last_login_at" pg_catalog.timestamptz,
  "notification_subscription_codes" pg_catalog.text[] DEFAULT '{}'::pg_catalog.text[] NOT NULL,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_app_user__user_id" PRIMARY KEY ("user_id"),
  CONSTRAINT "uq_app_user__username" UNIQUE ("username"),
  CONSTRAINT "ck_app_user__account_type__01" CHECK ("account_type" IN ( 'HUMAN' , 'SERVICE' )),
  CONSTRAINT "ck_app_user__status__01" CHECK ("status" IN ( 'ACTIVE' , 'LOCKED' , 'DISABLED' , 'PENDING_RESET' )),
  CONSTRAINT "ck_app_user__failed_login_count__01" CHECK ("failed_login_count" >= 0),
  CONSTRAINT "ck_app_user__notification_subscription_codes__01" CHECK (pg_catalog.cardinality ( "notification_subscription_codes" ) <= 64),
  CONSTRAINT "ck_app_user__notification_subscription_codes__02" CHECK (pg_catalog.array_position ( "notification_subscription_codes" , NULL ) IS NULL)
);

CREATE TABLE public."app_user_location_scope" (
  "user_location_scope_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "user_role_id" pg_catalog.uuid NOT NULL,
  "location_id" pg_catalog.uuid NOT NULL,
  "scope_level" pg_catalog.text NOT NULL,
  "valid_from" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "valid_to" pg_catalog.timestamptz,
  "granted_by_user_id" pg_catalog.uuid NOT NULL,
  "revoked_at" pg_catalog.timestamptz,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_app_user_location_scope__user_location_scope_id" PRIMARY KEY ("user_location_scope_id"),
  CONSTRAINT "uq_app_user_location_scope__user_role_id__location_i_66bbfd1b51" UNIQUE ("user_role_id", "location_id", "scope_level", "valid_from"),
  CONSTRAINT "ck_app_user_location_scope__table__01" CHECK ("valid_to" IS NULL OR "valid_to" > "valid_from"),
  CONSTRAINT "ck_app_user_location_scope__table__02" CHECK ("revoked_at" IS NULL OR "revoked_at" > "valid_from"),
  CONSTRAINT "ck_app_user_location_scope__scope_level__01" CHECK ("scope_level" IN ( 'READ' , 'WRITE' , 'ADMIN' )),
  CONSTRAINT "ex_app_user_location_scope__active_period" EXCLUDE USING gist (
      "user_role_id" WITH =,
      "location_id" WITH =,
      "scope_level" WITH =,
      pg_catalog.tstzrange("valid_from", LEAST(COALESCE("valid_to", 'infinity'::pg_catalog.timestamptz), COALESCE("revoked_at", 'infinity'::pg_catalog.timestamptz)), '[)') WITH &&
    ) DEFERRABLE INITIALLY IMMEDIATE
);

CREATE TABLE public."app_user_role" (
  "user_role_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "user_id" pg_catalog.uuid NOT NULL,
  "role_id" pg_catalog.uuid NOT NULL,
  "valid_from" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "valid_to" pg_catalog.timestamptz,
  "granted_by_user_id" pg_catalog.uuid NOT NULL,
  "revoked_at" pg_catalog.timestamptz,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_app_user_role__user_role_id" PRIMARY KEY ("user_role_id"),
  CONSTRAINT "uq_app_user_role__user_id__role_id__valid_from" UNIQUE ("user_id", "role_id", "valid_from"),
  CONSTRAINT "ck_app_user_role__table__01" CHECK ("valid_to" IS NULL OR "valid_to" > "valid_from"),
  CONSTRAINT "ck_app_user_role__table__02" CHECK ("revoked_at" IS NULL OR "revoked_at" > "valid_from"),
  CONSTRAINT "ex_app_user_role__active_period" EXCLUDE USING gist (
      "user_id" WITH =,
      "role_id" WITH =,
      pg_catalog.tstzrange("valid_from", LEAST(COALESCE("valid_to", 'infinity'::pg_catalog.timestamptz), COALESCE("revoked_at", 'infinity'::pg_catalog.timestamptz)), '[)') WITH &&
    ) DEFERRABLE INITIALLY IMMEDIATE
);
