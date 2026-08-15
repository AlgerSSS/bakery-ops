-- HOT CRUSH Core V1 R6 / scm physical tables
-- Generated deterministically. Do not hand-edit.
-- The psycopg2 apply runner owns the sole transaction, lock and SET LOCAL state.

CREATE TABLE public."scm_material" (
  "material_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "material_code" pg_catalog.text NOT NULL,
  "material_name" pg_catalog.text NOT NULL,
  "material_type" pg_catalog.text NOT NULL,
  "base_unit_id" pg_catalog.uuid NOT NULL,
  "shelf_life_days" pg_catalog.int4,
  "is_lot_tracked" pg_catalog.bool DEFAULT false NOT NULL,
  "status" pg_catalog.text DEFAULT 'DRAFT' NOT NULL,
  "created_by_user_id" pg_catalog.uuid,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_scm_material__material_id" PRIMARY KEY ("material_id"),
  CONSTRAINT "uq_scm_material__material_code" UNIQUE ("material_code"),
  CONSTRAINT "ck_scm_material__material_type__01" CHECK ("material_type" IN ( 'INGREDIENT' , 'PACKAGING' , 'SEMI_FINISHED' , 'CONSUMABLE' , 'FINISHED_GOOD' )),
  CONSTRAINT "ck_scm_material__shelf_life_days__01" CHECK ("shelf_life_days" IS NULL OR "shelf_life_days" > 0),
  CONSTRAINT "ck_scm_material__status__01" CHECK ("status" IN ( 'DRAFT' , 'ACTIVE' , 'SUSPENDED' , 'RETIRED' ))
);

CREATE TABLE public."scm_material_alias" (
  "material_alias_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "material_id" pg_catalog.uuid NOT NULL,
  "source_system_id" pg_catalog.uuid,
  "alias_text" pg_catalog.text NOT NULL,
  "valid_from" pg_catalog.date DEFAULT CURRENT_DATE NOT NULL,
  "valid_to" pg_catalog.date,
  "status" pg_catalog.text DEFAULT 'PENDING' NOT NULL,
  "created_by_user_id" pg_catalog.uuid,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_scm_material_alias__material_alias_id" PRIMARY KEY ("material_alias_id"),
  CONSTRAINT "uq_scm_material_alias__source_system_id__alias_text__valid_from" UNIQUE NULLS NOT DISTINCT ("source_system_id", "alias_text", "valid_from"),
  CONSTRAINT "ck_scm_material_alias__table__01" CHECK ("valid_to" IS NULL OR "valid_to" > "valid_from"),
  CONSTRAINT "ck_scm_material_alias__table__02" CHECK (public.app_normalize_alias_v1 ( "alias_text" ) <> ''),
  CONSTRAINT "ck_scm_material_alias__status__01" CHECK ("status" IN ( 'CONFIRMED' , 'PENDING' , 'REJECTED' )),
  CONSTRAINT "ex_scm_material_alias__confirmed_period" EXCLUDE USING gist (
      COALESCE("source_system_id", '00000000-0000-0000-0000-000000000000'::pg_catalog.uuid) WITH =,
      public.app_normalize_alias_v1("alias_text") WITH =,
      pg_catalog.daterange("valid_from", "valid_to", '[)') WITH &&
    ) WHERE ("status" = 'CONFIRMED') DEFERRABLE INITIALLY IMMEDIATE
);

CREATE TABLE public."scm_material_source_identity" (
  "material_source_identity_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "material_id" pg_catalog.uuid NOT NULL,
  "source_system_id" pg_catalog.uuid NOT NULL,
  "source_material_id" pg_catalog.text NOT NULL,
  "valid_from" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "valid_to" pg_catalog.timestamptz,
  "mapping_status" pg_catalog.text DEFAULT 'PENDING' NOT NULL,
  "evidence" pg_catalog.jsonb DEFAULT '{}'::pg_catalog.jsonb NOT NULL,
  "created_by_user_id" pg_catalog.uuid,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_scm_material_source_identity__material_source_identity_id" PRIMARY KEY ("material_source_identity_id"),
  CONSTRAINT "uq_scm_material_source_identity__source_system_id__s_4687273b21" UNIQUE ("source_system_id", "source_material_id", "valid_from"),
  CONSTRAINT "ck_scm_material_source_identity__table__01" CHECK ("valid_to" IS NULL OR "valid_to" > "valid_from"),
  CONSTRAINT "ck_scm_material_source_identity__mapping_status__01" CHECK ("mapping_status" IN ( 'CONFIRMED' , 'PENDING' , 'REJECTED' )),
  CONSTRAINT "ex_scm_material_source_identity__confirmed_period" EXCLUDE USING gist (
      "source_system_id" WITH =,
      "source_material_id" WITH =,
      pg_catalog.tstzrange("valid_from", "valid_to", '[)') WITH &&
    ) WHERE ("mapping_status" = 'CONFIRMED') DEFERRABLE INITIALLY IMMEDIATE
);

CREATE TABLE public."scm_material_unit_conversion" (
  "material_unit_conversion_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "material_id" pg_catalog.uuid NOT NULL,
  "from_unit_id" pg_catalog.uuid NOT NULL,
  "to_unit_id" pg_catalog.uuid NOT NULL,
  "conversion_factor" pg_catalog.numeric(24,12) NOT NULL,
  "valid_from" pg_catalog.timestamptz NOT NULL,
  "valid_to" pg_catalog.timestamptz,
  "source_system_id" pg_catalog.uuid,
  "evidence" pg_catalog.jsonb DEFAULT '{}'::pg_catalog.jsonb NOT NULL,
  "status" pg_catalog.text DEFAULT 'PENDING' NOT NULL,
  "verified_by_user_id" pg_catalog.uuid,
  "verified_at" pg_catalog.timestamptz,
  "created_by_user_id" pg_catalog.uuid,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_scm_material_unit_conversion__material_unit_conversion_id" PRIMARY KEY ("material_unit_conversion_id"),
  CONSTRAINT "uq_scm_material_unit_conversion__material_id__from_u_7392d112e7" UNIQUE ("material_id", "from_unit_id", "to_unit_id", "valid_from"),
  CONSTRAINT "ck_scm_material_unit_conversion__table__01" CHECK ("from_unit_id" <> "to_unit_id"),
  CONSTRAINT "ck_scm_material_unit_conversion__table__02" CHECK ("valid_to" IS NULL OR "valid_to" > "valid_from"),
  CONSTRAINT "ck_scm_material_unit_conversion__table__03" CHECK ("status" <> 'VERIFIED' OR "verified_at" IS NOT NULL),
  CONSTRAINT "ck_scm_material_unit_conversion__conversion_factor__01" CHECK ("conversion_factor" > 0),
  CONSTRAINT "ck_scm_material_unit_conversion__status__01" CHECK ("status" IN ( 'PENDING' , 'VERIFIED' , 'REJECTED' , 'RETIRED' )),
  CONSTRAINT "ex_scm_material_unit_conversion__verified_period" EXCLUDE USING gist (
      "material_id" WITH =,
      "from_unit_id" WITH =,
      "to_unit_id" WITH =,
      pg_catalog.tstzrange("valid_from", "valid_to", '[)') WITH &&
    ) WHERE ("status" = 'VERIFIED') DEFERRABLE INITIALLY IMMEDIATE
);

CREATE TABLE public."scm_supplier" (
  "supplier_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "supplier_code" pg_catalog.text NOT NULL,
  "supplier_name" pg_catalog.text NOT NULL,
  "legal_name" pg_catalog.text,
  "registration_no" pg_catalog.text,
  "country_code" pg_catalog.bpchar(2) DEFAULT 'MY' NOT NULL,
  "default_currency" pg_catalog.bpchar(3) DEFAULT 'MYR' NOT NULL,
  "payment_terms_days" pg_catalog.int4,
  "lead_time_days" pg_catalog.int4,
  "status" pg_catalog.text DEFAULT 'PENDING' NOT NULL,
  "contact_data" pg_catalog.jsonb DEFAULT '{}'::pg_catalog.jsonb NOT NULL,
  "created_by_user_id" pg_catalog.uuid,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_scm_supplier__supplier_id" PRIMARY KEY ("supplier_id"),
  CONSTRAINT "uq_scm_supplier__supplier_code" UNIQUE ("supplier_code"),
  CONSTRAINT "ck_scm_supplier__payment_terms_days__01" CHECK ("payment_terms_days" IS NULL OR "payment_terms_days" >= 0),
  CONSTRAINT "ck_scm_supplier__lead_time_days__01" CHECK ("lead_time_days" IS NULL OR "lead_time_days" >= 0),
  CONSTRAINT "ck_scm_supplier__status__01" CHECK ("status" IN ( 'PENDING' , 'ACTIVE' , 'SUSPENDED' , 'RETIRED' ))
);

CREATE TABLE public."scm_supplier_item" (
  "supplier_item_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "supplier_id" pg_catalog.uuid NOT NULL,
  "supersedes_supplier_item_id" pg_catalog.uuid,
  "supplier_sku" pg_catalog.text NOT NULL,
  "supplier_item_name" pg_catalog.text NOT NULL,
  "order_unit_id" pg_catalog.uuid NOT NULL,
  "material_id" pg_catalog.uuid,
  "material_unit_conversion_id" pg_catalog.uuid,
  "minimum_order_quantity" pg_catalog.numeric(18,4),
  "order_multiple" pg_catalog.numeric(18,4) DEFAULT 1 NOT NULL,
  "lead_time_days" pg_catalog.int4,
  "valid_from" pg_catalog.timestamptz NOT NULL,
  "valid_to" pg_catalog.timestamptz,
  "mapping_status" pg_catalog.text DEFAULT 'PENDING' NOT NULL,
  "evidence" pg_catalog.jsonb DEFAULT '{}'::pg_catalog.jsonb NOT NULL,
  "confirmed_by_user_id" pg_catalog.uuid,
  "confirmed_at" pg_catalog.timestamptz,
  "created_by_user_id" pg_catalog.uuid,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_scm_supplier_item__supplier_item_id" PRIMARY KEY ("supplier_item_id"),
  CONSTRAINT "uq_scm_supplier_item__supplier_id__supplier_sku__valid_from" UNIQUE ("supplier_id", "supplier_sku", "valid_from"),
  CONSTRAINT "ck_scm_supplier_item__table__01" CHECK ("valid_to" IS NULL OR "valid_to" > "valid_from"),
  CONSTRAINT "ck_scm_supplier_item__table__02" CHECK ("mapping_status" <> 'CONFIRMED' OR ( "material_id" IS NOT NULL AND "confirmed_at" IS NOT NULL )),
  CONSTRAINT "ck_scm_supplier_item__minimum_order_quantity__01" CHECK ("minimum_order_quantity" IS NULL OR "minimum_order_quantity" > 0),
  CONSTRAINT "ck_scm_supplier_item__order_multiple__01" CHECK ("order_multiple" > 0),
  CONSTRAINT "ck_scm_supplier_item__lead_time_days__01" CHECK ("lead_time_days" IS NULL OR "lead_time_days" >= 0),
  CONSTRAINT "ck_scm_supplier_item__mapping_status__01" CHECK ("mapping_status" IN ( 'PENDING' , 'CONFIRMED' , 'REJECTED' , 'RETIRED' )),
  CONSTRAINT "ex_scm_supplier_item__confirmed_period" EXCLUDE USING gist (
      "supplier_id" WITH =,
      "supplier_sku" WITH =,
      pg_catalog.tstzrange("valid_from", "valid_to", '[)') WITH &&
    ) WHERE ("mapping_status" = 'CONFIRMED') DEFERRABLE INITIALLY IMMEDIATE
);

CREATE TABLE public."scm_supplier_price_observation" (
  "supplier_price_observation_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "supplier_item_id" pg_catalog.uuid NOT NULL,
  "source_system_id" pg_catalog.uuid NOT NULL,
  "source_record_id" pg_catalog.text,
  "goods_receipt_line_id" pg_catalog.uuid,
  "purchase_order_line_id" pg_catalog.uuid,
  "observation_type" pg_catalog.text NOT NULL,
  "observed_at" pg_catalog.timestamptz NOT NULL,
  "raw_unit_price" pg_catalog.numeric(18,6) NOT NULL,
  "raw_price_unit_text" pg_catalog.text NOT NULL,
  "raw_price_unit_id" pg_catalog.uuid,
  "material_unit_conversion_id" pg_catalog.uuid,
  "currency" pg_catalog.bpchar(3) DEFAULT 'MYR' NOT NULL,
  "fx_rate_to_myr" pg_catalog.numeric(18,8),
  "fx_source_ref" pg_catalog.text,
  "normalization_detail" pg_catalog.jsonb DEFAULT '{}'::pg_catalog.jsonb NOT NULL,
  "quality_status" pg_catalog.text NOT NULL,
  "verified_by_user_id" pg_catalog.uuid,
  "verified_at" pg_catalog.timestamptz,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_scm_supplier_price_observation__supplier_price_ob_161d1096db" PRIMARY KEY ("supplier_price_observation_id"),
  CONSTRAINT "uq_scm_supplier_price_observation__source_system_id__70c6ded9e9" UNIQUE NULLS DISTINCT ("source_system_id", "source_record_id"),
  CONSTRAINT "uq_scm_supplier_price_observation__goods_receipt_lin_305c0e7e6a" UNIQUE NULLS DISTINCT ("goods_receipt_line_id", "observation_type"),
  CONSTRAINT "uq_scm_supplier_price_observation__purchase_order_li_d04f44fb76" UNIQUE NULLS DISTINCT ("purchase_order_line_id", "observation_type"),
  CONSTRAINT "ck_scm_supplier_price_observation__table__01" CHECK (pg_catalog.num_nonnulls ( "goods_receipt_line_id" , "purchase_order_line_id" , "source_record_id" ) >= 1),
  CONSTRAINT "ck_scm_supplier_price_observation__table__02" CHECK ("currency" = 'MYR' OR "fx_rate_to_myr" IS NOT NULL),
  CONSTRAINT "ck_scm_supplier_price_observation__table__03" CHECK ("quality_status" <> 'VERIFIED' OR "verified_at" IS NOT NULL),
  CONSTRAINT "ck_scm_supplier_price_observation__observation_type__01" CHECK ("observation_type" IN ( 'QUOTE' , 'PO_CONFIRMED' , 'RECEIPT_ACTUAL' , 'MANUAL_MARKET_CHECK' )),
  CONSTRAINT "ck_scm_supplier_price_observation__raw_unit_price__01" CHECK ("raw_unit_price" >= 0),
  CONSTRAINT "ck_scm_supplier_price_observation__fx_rate_to_myr__01" CHECK ("fx_rate_to_myr" IS NULL OR "fx_rate_to_myr" > 0),
  CONSTRAINT "ck_scm_supplier_price_observation__quality_status__01" CHECK ("quality_status" IN ( 'VERIFIED' , 'UNVERIFIED' , 'UNIT_ERROR' , 'FX_MISSING' , 'REJECTED' ))
);
