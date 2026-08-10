-- HOT CRUSH Core V1 R6 / cost physical tables
-- Generated deterministically. Do not hand-edit.
-- The psycopg2 apply runner owns the sole transaction, lock and SET LOCAL state.

CREATE TABLE public."cost_card_material_price" (
  "material_price_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "material_id" pg_catalog.uuid NOT NULL,
  "location_id" pg_catalog.uuid,
  "supplier_price_observation_id" pg_catalog.uuid,
  "price_myr_per_base_unit" pg_catalog.numeric(18,8) NOT NULL,
  "price_source" pg_catalog.text NOT NULL,
  "effective_from" pg_catalog.timestamptz NOT NULL,
  "effective_to" pg_catalog.timestamptz,
  "quality_status" pg_catalog.text NOT NULL,
  "evidence" pg_catalog.jsonb DEFAULT '{}'::pg_catalog.jsonb NOT NULL,
  "approved_by_user_id" pg_catalog.uuid,
  "created_by_user_id" pg_catalog.uuid,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_cost_card_material_price__material_price_id" PRIMARY KEY ("material_price_id"),
  CONSTRAINT "uq_cost_card_material_price__material_id__location_i_5d777e74e5" UNIQUE NULLS NOT DISTINCT ("material_id", "location_id", "effective_from"),
  CONSTRAINT "ck_cost_card_material_price__table__01" CHECK ("effective_to" IS NULL OR "effective_to" > "effective_from"),
  CONSTRAINT "ck_cost_card_material_price__price_myr_per_base_unit__01" CHECK ("price_myr_per_base_unit" >= 0),
  CONSTRAINT "ck_cost_card_material_price__price_source__01" CHECK ("price_source" IN ( 'RECEIPT_ACTUAL' , 'PO_CONFIRMED' , 'QUOTE' , 'MIGRATED_MANUAL' , 'MANUAL' , 'FALLBACK' )),
  CONSTRAINT "ck_cost_card_material_price__quality_status__01" CHECK ("quality_status" IN ( 'VERIFIED' , 'ESTIMATED' , 'STALE' , 'UNIT_ERROR' , 'REJECTED' )),
  CONSTRAINT "ex_cost_card_material_price__usable_period" EXCLUDE USING gist (
      "material_id" WITH =,
      COALESCE("location_id", '00000000-0000-0000-0000-000000000000'::pg_catalog.uuid) WITH =,
      pg_catalog.tstzrange("effective_from", "effective_to", '[)') WITH &&
    ) WHERE ("quality_status" IN ('VERIFIED', 'ESTIMATED', 'STALE')) DEFERRABLE INITIALLY IMMEDIATE
);

CREATE TABLE public."cost_card_recipe_component" (
  "recipe_component_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "recipe_version_id" pg_catalog.uuid NOT NULL,
  "material_id" pg_catalog.uuid NOT NULL,
  "sequence_no" pg_catalog.int4 NOT NULL,
  "input_quantity" pg_catalog.numeric(18,8) NOT NULL,
  "input_unit_id" pg_catalog.uuid NOT NULL,
  "material_unit_conversion_id" pg_catalog.uuid,
  "net_yield_rate" pg_catalog.numeric(9,6) DEFAULT 1 NOT NULL,
  "loss_rate" pg_catalog.numeric(9,6) DEFAULT 0 NOT NULL,
  "is_optional" pg_catalog.bool DEFAULT false NOT NULL,
  "condition_schema_version" pg_catalog.text,
  "condition_rule" pg_catalog.jsonb,
  "note" pg_catalog.text,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_cost_card_recipe_component__recipe_component_id" PRIMARY KEY ("recipe_component_id"),
  CONSTRAINT "uq_cost_card_recipe_component__recipe_version_id__sequence_no" UNIQUE ("recipe_version_id", "sequence_no"),
  CONSTRAINT "ck_cost_card_recipe_component__table__01" CHECK (( "condition_rule" IS NULL ) = ( "condition_schema_version" IS NULL )),
  CONSTRAINT "ck_cost_card_recipe_component__table__02" CHECK ("is_optional" = ( "condition_rule" IS NOT NULL )),
  CONSTRAINT "ck_cost_card_recipe_component__sequence_no__01" CHECK ("sequence_no" > 0),
  CONSTRAINT "ck_cost_card_recipe_component__input_quantity__01" CHECK ("input_quantity" > 0),
  CONSTRAINT "ck_cost_card_recipe_component__net_yield_rate__01" CHECK ("net_yield_rate" > 0 AND "net_yield_rate" <= 1),
  CONSTRAINT "ck_cost_card_recipe_component__loss_rate__01" CHECK ("loss_rate" >= 0 AND "loss_rate" < 1)
);

CREATE TABLE public."cost_card_recipe_version" (
  "recipe_version_id" pg_catalog.uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  "recipe_code" pg_catalog.text NOT NULL,
  "recipe_name" pg_catalog.text NOT NULL,
  "output_product_id" pg_catalog.uuid,
  "output_material_id" pg_catalog.uuid,
  "version_no" pg_catalog.int4 NOT NULL,
  "batch_yield_quantity" pg_catalog.numeric(18,6) NOT NULL,
  "yield_unit_id" pg_catalog.uuid NOT NULL,
  "reference_sale_price" pg_catalog.numeric(18,4),
  "currency" pg_catalog.bpchar(3) DEFAULT 'MYR' NOT NULL,
  "effective_from" pg_catalog.timestamptz,
  "effective_to" pg_catalog.timestamptz,
  "status" pg_catalog.text NOT NULL,
  "notes" pg_catalog.text,
  "lock_version" pg_catalog.int4 DEFAULT 1 NOT NULL,
  "approved_by_user_id" pg_catalog.uuid,
  "approved_at" pg_catalog.timestamptz,
  "created_by_user_id" pg_catalog.uuid,
  "created_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  "updated_at" pg_catalog.timestamptz DEFAULT pg_catalog.now() NOT NULL,
  CONSTRAINT "pk_cost_card_recipe_version__recipe_version_id" PRIMARY KEY ("recipe_version_id"),
  CONSTRAINT "uq_cost_card_recipe_version__recipe_code__version_no" UNIQUE ("recipe_code", "version_no"),
  CONSTRAINT "ck_cost_card_recipe_version__table__01" CHECK (( "output_product_id" IS NOT NULL ) <> ( "output_material_id" IS NOT NULL )),
  CONSTRAINT "ck_cost_card_recipe_version__table__02" CHECK ("effective_to" IS NULL OR "effective_to" > "effective_from"),
  CONSTRAINT "ck_cost_card_recipe_version__table__03" CHECK ("effective_from" IS NOT NULL OR ( "status" = 'DRAFT' AND "effective_to" IS NULL )),
  CONSTRAINT "ck_cost_card_recipe_version__version_no__01" CHECK ("version_no" > 0),
  CONSTRAINT "ck_cost_card_recipe_version__batch_yield_quantity__01" CHECK ("batch_yield_quantity" > 0),
  CONSTRAINT "ck_cost_card_recipe_version__reference_sale_price__01" CHECK ("reference_sale_price" IS NULL OR "reference_sale_price" >= 0),
  CONSTRAINT "ck_cost_card_recipe_version__status__01" CHECK ("status" IN ( 'DRAFT' , 'PUBLISHED' , 'ARCHIVED' , 'REJECTED' )),
  CONSTRAINT "ck_cost_card_recipe_version__lock_version__01" CHECK ("lock_version" > 0),
  CONSTRAINT "ex_cost_card_recipe_version__published_period" EXCLUDE USING gist (
      "recipe_code" WITH =,
      pg_catalog.tstzrange("effective_from", "effective_to", '[)') WITH &&
    ) WHERE ("status" = 'PUBLISHED') DEFERRABLE INITIALLY IMMEDIATE
);
