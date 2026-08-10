-- HOT CRUSH Core V1 R6 / hr physical tables
-- Generated deterministically. Do not hand-edit.
-- The psycopg2 apply runner owns the sole transaction, lock and SET LOCAL state.

CREATE TABLE public."hr_application" (
  "application_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "person_id" pg_catalog.uuid NOT NULL,
  "job_requisition_id" pg_catalog.uuid NOT NULL,
  "source_system_id" pg_catalog.uuid NOT NULL,
  "source_application_id" pg_catalog.text,
  "applied_at" pg_catalog.timestamptz NOT NULL,
  "created_by_user_id" pg_catalog.uuid,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_hr_application__application_id" PRIMARY KEY ("application_id"),
  CONSTRAINT "uq_hr_application__source_system_id__source_application_id" UNIQUE NULLS DISTINCT ("source_system_id", "source_application_id")
);

CREATE TABLE public."hr_application_stage_event" (
  "application_stage_event_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "application_id" pg_catalog.uuid NOT NULL,
  "source_system_id" pg_catalog.uuid,
  "job_run_id" pg_catalog.uuid,
  "actor_user_id" pg_catalog.uuid,
  "event_key" pg_catalog.text NOT NULL,
  "from_stage" pg_catalog.text,
  "to_stage" pg_catalog.text NOT NULL,
  "reason_code" pg_catalog.text,
  "occurred_at" pg_catalog.timestamptz NOT NULL,
  "evidence" pg_catalog.jsonb DEFAULT '{}'::pg_catalog.jsonb NOT NULL,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_hr_application_stage_event__application_stage_event_id" PRIMARY KEY ("application_stage_event_id"),
  CONSTRAINT "uq_hr_application_stage_event__event_key" UNIQUE ("event_key"),
  CONSTRAINT "ck_hr_application_stage_event__table__01" CHECK ("from_stage" IS NULL OR "from_stage" <> "to_stage"),
  CONSTRAINT "ck_hr_application_stage_event__table__02" CHECK (pg_catalog.num_nonnulls ( "source_system_id" , "job_run_id" , "actor_user_id" ) >= 1),
  CONSTRAINT "ck_hr_application_stage_event__to_stage__01" CHECK ("to_stage" IN ( 'NEW' , 'CONTACTING' , 'INTERVIEW' , 'TRIAL' , 'OFFER' , 'HIRED' , 'REJECTED' , 'WITHDRAWN' , 'TALENT_POOL' ))
);

CREATE TABLE public."hr_appointment" (
  "appointment_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "application_id" pg_catalog.uuid NOT NULL,
  "location_id" pg_catalog.uuid,
  "appointment_type" pg_catalog.text NOT NULL,
  "scheduled_start" pg_catalog.timestamptz NOT NULL,
  "scheduled_end" pg_catalog.timestamptz,
  "status" pg_catalog.text NOT NULL,
  "confirmed_at" pg_catalog.timestamptz,
  "confirmed_by_user_id" pg_catalog.uuid,
  "actual_start" pg_catalog.timestamptz,
  "actual_end" pg_catalog.timestamptz,
  "trial_outcome" pg_catalog.text,
  "safety_incident" pg_catalog.bool DEFAULT false NOT NULL,
  "execution_note" pg_catalog.text,
  "created_by_user_id" pg_catalog.uuid,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_hr_appointment__appointment_id" PRIMARY KEY ("appointment_id"),
  CONSTRAINT "ck_hr_appointment__table__01" CHECK ("scheduled_end" IS NULL OR "scheduled_end" > "scheduled_start"),
  CONSTRAINT "ck_hr_appointment__table__02" CHECK ("actual_end" IS NULL OR "actual_start" IS NULL OR "actual_end" >= "actual_start"),
  CONSTRAINT "ck_hr_appointment__table__03" CHECK ("trial_outcome" IS NULL OR "appointment_type" = 'TRIAL'),
  CONSTRAINT "ck_hr_appointment__appointment_type__01" CHECK ("appointment_type" IN ( 'INTERVIEW' , 'TRIAL' , 'DOCUMENT' , 'OTHER' )),
  CONSTRAINT "ck_hr_appointment__status__01" CHECK ("status" IN ( 'PROPOSED' , 'CONFIRMED' , 'COMPLETED' , 'NO_SHOW' , 'STOPPED' , 'CANCELLED' , 'RESCHEDULED' )),
  CONSTRAINT "ck_hr_appointment__trial_outcome__01" CHECK ("trial_outcome" IS NULL OR "trial_outcome" IN ( 'PASS' , 'CONDITIONAL_PASS' , 'FAIL' , 'INCOMPLETE' ))
);

CREATE TABLE public."hr_assessment" (
  "assessment_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "application_id" pg_catalog.uuid NOT NULL,
  "appointment_id" pg_catalog.uuid,
  "assessor_employment_id" pg_catalog.uuid NOT NULL,
  "assessment_type" pg_catalog.text NOT NULL,
  "template_version" pg_catalog.text NOT NULL,
  "recommendation" pg_catalog.text NOT NULL,
  "red_flag" pg_catalog.bool DEFAULT false NOT NULL,
  "summary" pg_catalog.text,
  "assessed_at" pg_catalog.timestamptz NOT NULL,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_hr_assessment__assessment_id" PRIMARY KEY ("assessment_id"),
  CONSTRAINT "ck_hr_assessment__assessment_type__01" CHECK ("assessment_type" IN ( 'SCREENING' , 'INTERVIEW' , 'TRIAL' , 'KPA' , 'OTHER' )),
  CONSTRAINT "ck_hr_assessment__recommendation__01" CHECK ("recommendation" IN ( 'STRONG_HIRE' , 'HIRE' , 'HOLD' , 'NO_HIRE' , 'INCOMPLETE' ))
);

CREATE TABLE public."hr_assessment_score" (
  "assessment_score_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "assessment_id" pg_catalog.uuid NOT NULL,
  "criterion_code" pg_catalog.text NOT NULL,
  "criterion_name" pg_catalog.text NOT NULL,
  "score" pg_catalog.numeric(9,4),
  "max_score" pg_catalog.numeric(9,4) NOT NULL,
  "weight" pg_catalog.numeric(9,6) DEFAULT 1 NOT NULL,
  "is_red_flag" pg_catalog.bool DEFAULT false NOT NULL,
  "evidence_note" pg_catalog.text,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_hr_assessment_score__assessment_score_id" PRIMARY KEY ("assessment_score_id"),
  CONSTRAINT "uq_hr_assessment_score__assessment_id__criterion_code" UNIQUE ("assessment_id", "criterion_code"),
  CONSTRAINT "ck_hr_assessment_score__table__01" CHECK ("score" IS NULL OR ( "score" >= 0 AND "score" <= "max_score" )),
  CONSTRAINT "ck_hr_assessment_score__max_score__01" CHECK ("max_score" > 0),
  CONSTRAINT "ck_hr_assessment_score__weight__01" CHECK ("weight" >= 0)
);

CREATE TABLE public."hr_employee_event" (
  "employee_event_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "employment_id" pg_catalog.uuid NOT NULL,
  "event_type" pg_catalog.text NOT NULL,
  "effective_date" pg_catalog.date NOT NULL,
  "from_location_id" pg_catalog.uuid,
  "to_location_id" pg_catalog.uuid,
  "event_schema_version" pg_catalog.text DEFAULT 'hr-employee-event-v1' NOT NULL,
  "event_data" pg_catalog.jsonb DEFAULT '{}'::pg_catalog.jsonb NOT NULL,
  "reason_code" pg_catalog.text,
  "note" pg_catalog.text,
  "recorded_by_user_id" pg_catalog.uuid NOT NULL,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_hr_employee_event__employee_event_id" PRIMARY KEY ("employee_event_id"),
  CONSTRAINT "ck_hr_employee_event__event_type__01" CHECK ("event_type" IN ( 'CONFIRMATION' , 'TRANSFER' , 'PROMOTION' , 'DISCIPLINE' , 'SUSPENSION' , 'RESIGNATION' , 'TERMINATION' , 'OTHER' ))
);

CREATE TABLE public."hr_employment" (
  "employment_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "person_id" pg_catalog.uuid NOT NULL,
  "origin_application_id" pg_catalog.uuid,
  "home_location_id" pg_catalog.uuid,
  "employee_code" pg_catalog.text NOT NULL,
  "employment_type" pg_catalog.text NOT NULL,
  "started_on" pg_catalog.date NOT NULL,
  "ended_on" pg_catalog.date,
  "status" pg_catalog.text NOT NULL,
  "job_title" pg_catalog.text,
  "created_by_user_id" pg_catalog.uuid,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_hr_employment__employment_id" PRIMARY KEY ("employment_id"),
  CONSTRAINT "uq_hr_employment__employee_code" UNIQUE ("employee_code"),
  CONSTRAINT "uq_hr_employment__origin_application_id" UNIQUE NULLS DISTINCT ("origin_application_id"),
  CONSTRAINT "ck_hr_employment__table__01" CHECK ("ended_on" IS NULL OR "ended_on" >= "started_on"),
  CONSTRAINT "ck_hr_employment__employment_type__01" CHECK ("employment_type" IN ( 'FULL_TIME' , 'PART_TIME' , 'CONTRACTOR' , 'INTERN' , 'CASUAL' )),
  CONSTRAINT "ck_hr_employment__status__01" CHECK ("status" IN ( 'PLANNED' , 'ACTIVE' , 'SUSPENDED' , 'ENDED' , 'CANCELLED' ))
);

CREATE TABLE public."hr_employment_mapping_review" (
  "employment_mapping_review_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "source_system_id" pg_catalog.uuid NOT NULL,
  "source_employee_id" pg_catalog.text NOT NULL,
  "candidate_person_id" pg_catalog.uuid,
  "candidate_employment_id" pg_catalog.uuid,
  "match_method" pg_catalog.text NOT NULL,
  "evidence" pg_catalog.jsonb DEFAULT '{}'::pg_catalog.jsonb NOT NULL,
  "status" pg_catalog.text DEFAULT 'OPEN' NOT NULL,
  "confirmed_source_identity_id" pg_catalog.uuid,
  "resolution_note" pg_catalog.text,
  "reviewed_by_user_id" pg_catalog.uuid,
  "reviewed_at" pg_catalog.timestamptz,
  "created_by_user_id" pg_catalog.uuid,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_hr_employment_mapping_review__employment_mapping_review_id" PRIMARY KEY ("employment_mapping_review_id"),
  CONSTRAINT "ck_hr_employment_mapping_review__table__01" CHECK ("status" <> 'CONFIRMED' OR "confirmed_source_identity_id" IS NOT NULL),
  CONSTRAINT "ck_hr_employment_mapping_review__match_method__01" CHECK ("match_method" IN ( 'EXACT_EMPLOYEE_CODE' , 'SOURCE_LINK' , 'MULTI_ATTRIBUTE' , 'NO_CANDIDATE' )),
  CONSTRAINT "ck_hr_employment_mapping_review__status__01" CHECK ("status" IN ( 'OPEN' , 'CONFIRMED' , 'REJECTED' , 'SPLIT_REQUIRED' , 'DISMISSED' ))
);

CREATE TABLE public."hr_employment_source_identity" (
  "employment_source_identity_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "employment_id" pg_catalog.uuid NOT NULL,
  "source_system_id" pg_catalog.uuid NOT NULL,
  "source_employee_id" pg_catalog.text NOT NULL,
  "valid_from" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "valid_to" pg_catalog.timestamptz,
  "mapping_status" pg_catalog.text DEFAULT 'PENDING' NOT NULL,
  "evidence" pg_catalog.jsonb DEFAULT '{}'::pg_catalog.jsonb NOT NULL,
  "created_by_user_id" pg_catalog.uuid,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_hr_employment_source_identity__employment_source_identity_id" PRIMARY KEY ("employment_source_identity_id"),
  CONSTRAINT "uq_hr_employment_source_identity__source_system_id___78262eac04" UNIQUE ("source_system_id", "source_employee_id", "valid_from"),
  CONSTRAINT "ck_hr_employment_source_identity__table__01" CHECK ("valid_to" IS NULL OR "valid_to" > "valid_from"),
  CONSTRAINT "ck_hr_employment_source_identity__mapping_status__01" CHECK ("mapping_status" IN ( 'CONFIRMED' , 'PENDING' , 'REJECTED' )),
  CONSTRAINT "ex_hr_employment_source_identity__confirmed_period" EXCLUDE USING gist (
      "source_system_id" WITH =,
      "source_employee_id" WITH =,
      pg_catalog.tstzrange("valid_from", "valid_to", '[)') WITH &&
    ) WHERE ("mapping_status" = 'CONFIRMED') DEFERRABLE INITIALLY IMMEDIATE
);

CREATE TABLE public."hr_job_requisition" (
  "job_requisition_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "location_id" pg_catalog.uuid NOT NULL,
  "role_id" pg_catalog.uuid,
  "requisition_code" pg_catalog.text NOT NULL,
  "headcount_requested" pg_catalog.int4 NOT NULL,
  "employment_type" pg_catalog.text NOT NULL,
  "target_start_date" pg_catalog.date,
  "status" pg_catalog.text NOT NULL,
  "approved_at" pg_catalog.timestamptz,
  "approved_by_user_id" pg_catalog.uuid,
  "created_by_user_id" pg_catalog.uuid,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_hr_job_requisition__job_requisition_id" PRIMARY KEY ("job_requisition_id"),
  CONSTRAINT "uq_hr_job_requisition__requisition_code" UNIQUE ("requisition_code"),
  CONSTRAINT "ck_hr_job_requisition__headcount_requested__01" CHECK ("headcount_requested" > 0),
  CONSTRAINT "ck_hr_job_requisition__employment_type__01" CHECK ("employment_type" IN ( 'FULL_TIME' , 'PART_TIME' , 'CONTRACTOR' , 'INTERN' , 'CASUAL' )),
  CONSTRAINT "ck_hr_job_requisition__status__01" CHECK ("status" IN ( 'DRAFT' , 'APPROVED' , 'OPEN' , 'ON_HOLD' , 'FILLED' , 'CANCELLED' ))
);

CREATE TABLE public."hr_offer" (
  "offer_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "application_id" pg_catalog.uuid NOT NULL,
  "supersedes_offer_id" pg_catalog.uuid,
  "location_id" pg_catalog.uuid NOT NULL,
  "role_id" pg_catalog.uuid,
  "version_no" pg_catalog.int4 NOT NULL,
  "employment_type" pg_catalog.text NOT NULL,
  "proposed_start_date" pg_catalog.date NOT NULL,
  "compensation_schema_version" pg_catalog.text DEFAULT 'offer-compensation-v1' NOT NULL,
  "compensation_summary" pg_catalog.jsonb NOT NULL,
  "expires_at" pg_catalog.timestamptz,
  "status" pg_catalog.text NOT NULL,
  "responded_at" pg_catalog.timestamptz,
  "created_by_user_id" pg_catalog.uuid,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_hr_offer__offer_id" PRIMARY KEY ("offer_id"),
  CONSTRAINT "uq_hr_offer__application_id__version_no" UNIQUE ("application_id", "version_no"),
  CONSTRAINT "ck_hr_offer__version_no__01" CHECK ("version_no" > 0),
  CONSTRAINT "ck_hr_offer__status__01" CHECK ("status" IN ( 'DRAFT' , 'SENT' , 'ACCEPTED' , 'DECLINED' , 'EXPIRED' , 'WITHDRAWN' , 'SUPERSEDED' ))
);

CREATE TABLE public."hr_person" (
  "person_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "display_name" pg_catalog.text NOT NULL,
  "legal_name" pg_catalog.text,
  "preferred_name" pg_catalog.text,
  "dedupe_fingerprint" pg_catalog.bpchar(64),
  "status" pg_catalog.text DEFAULT 'ACTIVE' NOT NULL,
  "merged_into_person_id" pg_catalog.uuid,
  "created_by_user_id" pg_catalog.uuid,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_hr_person__person_id" PRIMARY KEY ("person_id"),
  CONSTRAINT "uq_hr_person__dedupe_fingerprint" UNIQUE NULLS DISTINCT ("dedupe_fingerprint"),
  CONSTRAINT "ck_hr_person__status__01" CHECK ("status" IN ( 'ACTIVE' , 'MERGED' , 'DECEASED' , 'RESTRICTED' ))
);

CREATE TABLE public."hr_person_contact" (
  "person_contact_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "person_id" pg_catalog.uuid NOT NULL,
  "contact_type" pg_catalog.text NOT NULL,
  "contact_ciphertext" pg_catalog.bytea NOT NULL,
  "lookup_hash" pg_catalog.bpchar(64) NOT NULL,
  "is_primary" pg_catalog.bool DEFAULT false NOT NULL,
  "verified_at" pg_catalog.timestamptz,
  "valid_from" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "valid_to" pg_catalog.timestamptz,
  "created_by_user_id" pg_catalog.uuid,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_hr_person_contact__person_contact_id" PRIMARY KEY ("person_contact_id"),
  CONSTRAINT "uq_hr_person_contact__person_id__contact_type__looku_57658b59c4" UNIQUE ("person_id", "contact_type", "lookup_hash", "valid_from"),
  CONSTRAINT "ck_hr_person_contact__table__01" CHECK ("valid_to" IS NULL OR "valid_to" > "valid_from"),
  CONSTRAINT "ck_hr_person_contact__contact_type__01" CHECK ("contact_type" IN ( 'PHONE' , 'EMAIL' , 'OTHER' )),
  CONSTRAINT "ex_hr_person_contact__value_period" EXCLUDE USING gist (
      "person_id" WITH =,
      "contact_type" WITH =,
      "lookup_hash" WITH =,
      pg_catalog.tstzrange("valid_from", "valid_to", '[)') WITH &&
    ) DEFERRABLE INITIALLY IMMEDIATE,
  CONSTRAINT "ex_hr_person_contact__primary_period" EXCLUDE USING gist (
      "person_id" WITH =,
      "contact_type" WITH =,
      pg_catalog.tstzrange("valid_from", "valid_to", '[)') WITH &&
    ) WHERE ("is_primary" = true) DEFERRABLE INITIALLY IMMEDIATE
);

CREATE TABLE public."hr_screening_rule" (
  "screening_rule_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "rule_code" pg_catalog.text NOT NULL,
  "version_no" pg_catalog.int4 NOT NULL,
  "role_id" pg_catalog.uuid,
  "rule_type" pg_catalog.text NOT NULL,
  "rule_schema_version" pg_catalog.text DEFAULT 'hr-screening-rule-v1' NOT NULL,
  "rule_definition" pg_catalog.jsonb NOT NULL,
  "evidence_summary" pg_catalog.text NOT NULL,
  "sample_size" pg_catalog.int4,
  "confidence" pg_catalog.numeric(5,4),
  "status" pg_catalog.text NOT NULL,
  "approved_by_user_id" pg_catalog.uuid,
  "created_by_user_id" pg_catalog.uuid,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_hr_screening_rule__screening_rule_id" PRIMARY KEY ("screening_rule_id"),
  CONSTRAINT "uq_hr_screening_rule__rule_code__version_no" UNIQUE ("rule_code", "version_no"),
  CONSTRAINT "ck_hr_screening_rule__version_no__01" CHECK ("version_no" > 0),
  CONSTRAINT "ck_hr_screening_rule__rule_type__01" CHECK ("rule_type" IN ( 'ELIGIBILITY' , 'RISK_SIGNAL' , 'QUESTION_PROMPT' )),
  CONSTRAINT "ck_hr_screening_rule__sample_size__01" CHECK ("sample_size" IS NULL OR "sample_size" > 0),
  CONSTRAINT "ck_hr_screening_rule__status__01" CHECK ("status" IN ( 'DRAFT' , 'APPROVED' , 'ACTIVE' , 'RETIRED' ))
);
