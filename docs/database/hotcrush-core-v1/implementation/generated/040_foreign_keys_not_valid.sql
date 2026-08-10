-- HOT CRUSH Core V1 R6 / 040 foreign keys added NOT VALID
-- Generated deterministically. Do not hand-edit.
-- The psycopg2 apply runner owns the sole transaction, lock and SET LOCAL state.

SET LOCAL row_security = off;

DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ai_call" AS child
     WHERE child."actor_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."actor_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ai_call__actor_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ai_call"
  ADD CONSTRAINT "fk_ai_call__actor_user_id__app_user"
  FOREIGN KEY ("actor_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ai_call" AS child
     WHERE child."job_run_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_job_run" AS parent
          WHERE parent."job_run_id" = child."job_run_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ai_call__job_run_id__app_job_run';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ai_call"
  ADD CONSTRAINT "fk_ai_call__job_run_id__app_job_run"
  FOREIGN KEY ("job_run_id")
  REFERENCES public."app_job_run" ("job_run_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ai_call" AS child
     WHERE child."prompt_template_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ai_prompt_template" AS parent
          WHERE parent."prompt_template_id" = child."prompt_template_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ai_call__prompt_template_id__ai_prompt_template';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ai_call"
  ADD CONSTRAINT "fk_ai_call__prompt_template_id__ai_prompt_template"
  FOREIGN KEY ("prompt_template_id")
  REFERENCES public."ai_prompt_template" ("prompt_template_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ai_prompt_segment" AS child
     WHERE child."approved_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."approved_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ai_prompt_segment__approved_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ai_prompt_segment"
  ADD CONSTRAINT "fk_ai_prompt_segment__approved_by_user_id__app_user"
  FOREIGN KEY ("approved_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ai_prompt_segment" AS child
     WHERE child."created_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."created_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ai_prompt_segment__created_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ai_prompt_segment"
  ADD CONSTRAINT "fk_ai_prompt_segment__created_by_user_id__app_user"
  FOREIGN KEY ("created_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ai_prompt_template" AS child
     WHERE child."approved_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."approved_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ai_prompt_template__approved_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ai_prompt_template"
  ADD CONSTRAINT "fk_ai_prompt_template__approved_by_user_id__app_user"
  FOREIGN KEY ("approved_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ai_prompt_template" AS child
     WHERE child."created_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."created_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ai_prompt_template__created_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ai_prompt_template"
  ADD CONSTRAINT "fk_ai_prompt_template__created_by_user_id__app_user"
  FOREIGN KEY ("created_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ai_prompt_template_segment" AS child
     WHERE child."prompt_segment_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ai_prompt_segment" AS parent
          WHERE parent."prompt_segment_id" = child."prompt_segment_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ai_prompt_template_segment__prompt_segment_id__ai_9b32437e74';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ai_prompt_template_segment"
  ADD CONSTRAINT "fk_ai_prompt_template_segment__prompt_segment_id__ai_9b32437e74"
  FOREIGN KEY ("prompt_segment_id")
  REFERENCES public."ai_prompt_segment" ("prompt_segment_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ai_prompt_template_segment" AS child
     WHERE child."prompt_template_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ai_prompt_template" AS parent
          WHERE parent."prompt_template_id" = child."prompt_template_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ai_prompt_template_segment__prompt_template_id__a_1f5b32f5bf';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ai_prompt_template_segment"
  ADD CONSTRAINT "fk_ai_prompt_template_segment__prompt_template_id__a_1f5b32f5bf"
  FOREIGN KEY ("prompt_template_id")
  REFERENCES public."ai_prompt_template" ("prompt_template_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."app_audit_event" AS child
     WHERE child."actor_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."actor_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_app_audit_event__actor_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."app_audit_event"
  ADD CONSTRAINT "fk_app_audit_event__actor_user_id__app_user"
  FOREIGN KEY ("actor_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."app_audit_event" AS child
     WHERE child."job_run_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_job_run" AS parent
          WHERE parent."job_run_id" = child."job_run_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_app_audit_event__job_run_id__app_job_run';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."app_audit_event"
  ADD CONSTRAINT "fk_app_audit_event__job_run_id__app_job_run"
  FOREIGN KEY ("job_run_id")
  REFERENCES public."app_job_run" ("job_run_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."app_job_run" AS child
     WHERE child."source_system_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_source_system" AS parent
          WHERE parent."source_system_id" = child."source_system_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_app_job_run__source_system_id__app_source_system';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."app_job_run"
  ADD CONSTRAINT "fk_app_job_run__source_system_id__app_source_system"
  FOREIGN KEY ("source_system_id")
  REFERENCES public."app_source_system" ("source_system_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."app_one_time_token" AS child
     WHERE child."application_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."hr_application" AS parent
          WHERE parent."application_id" = child."application_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_app_one_time_token__application_id__hr_application';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."app_one_time_token"
  ADD CONSTRAINT "fk_app_one_time_token__application_id__hr_application"
  FOREIGN KEY ("application_id")
  REFERENCES public."hr_application" ("application_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."app_one_time_token" AS child
     WHERE child."campaign_member_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."mkt_campaign_member" AS parent
          WHERE parent."campaign_member_id" = child."campaign_member_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_app_one_time_token__campaign_member_id__mkt_campaign_member';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."app_one_time_token"
  ADD CONSTRAINT "fk_app_one_time_token__campaign_member_id__mkt_campaign_member"
  FOREIGN KEY ("campaign_member_id")
  REFERENCES public."mkt_campaign_member" ("campaign_member_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."app_one_time_token" AS child
     WHERE child."member_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."pos_member" AS parent
          WHERE parent."member_id" = child."member_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_app_one_time_token__member_id__pos_member';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."app_one_time_token"
  ADD CONSTRAINT "fk_app_one_time_token__member_id__pos_member"
  FOREIGN KEY ("member_id")
  REFERENCES public."pos_member" ("member_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."app_one_time_token" AS child
     WHERE child."user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_app_one_time_token__user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."app_one_time_token"
  ADD CONSTRAINT "fk_app_one_time_token__user_id__app_user"
  FOREIGN KEY ("user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."app_session" AS child
     WHERE child."user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_app_session__user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."app_session"
  ADD CONSTRAINT "fk_app_session__user_id__app_user"
  FOREIGN KEY ("user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."app_unit" AS child
     WHERE child."canonical_unit_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_unit" AS parent
          WHERE parent."unit_id" = child."canonical_unit_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_app_unit__canonical_unit_id__app_unit';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."app_unit"
  ADD CONSTRAINT "fk_app_unit__canonical_unit_id__app_unit"
  FOREIGN KEY ("canonical_unit_id")
  REFERENCES public."app_unit" ("unit_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."app_unit" AS child
     WHERE child."created_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."created_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_app_unit__created_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."app_unit"
  ADD CONSTRAINT "fk_app_unit__created_by_user_id__app_user"
  FOREIGN KEY ("created_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."app_user" AS child
     WHERE child."person_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."hr_person" AS parent
          WHERE parent."person_id" = child."person_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_app_user__person_id__hr_person';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."app_user"
  ADD CONSTRAINT "fk_app_user__person_id__hr_person"
  FOREIGN KEY ("person_id")
  REFERENCES public."hr_person" ("person_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."app_user_location_scope" AS child
     WHERE child."granted_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."granted_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_app_user_location_scope__granted_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."app_user_location_scope"
  ADD CONSTRAINT "fk_app_user_location_scope__granted_by_user_id__app_user"
  FOREIGN KEY ("granted_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."app_user_location_scope" AS child
     WHERE child."location_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_location" AS parent
          WHERE parent."location_id" = child."location_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_app_user_location_scope__location_id__ops_location';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."app_user_location_scope"
  ADD CONSTRAINT "fk_app_user_location_scope__location_id__ops_location"
  FOREIGN KEY ("location_id")
  REFERENCES public."ops_location" ("location_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."app_user_location_scope" AS child
     WHERE child."user_role_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user_role" AS parent
          WHERE parent."user_role_id" = child."user_role_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_app_user_location_scope__user_role_id__app_user_role';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."app_user_location_scope"
  ADD CONSTRAINT "fk_app_user_location_scope__user_role_id__app_user_role"
  FOREIGN KEY ("user_role_id")
  REFERENCES public."app_user_role" ("user_role_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."app_user_role" AS child
     WHERE child."granted_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."granted_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_app_user_role__granted_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."app_user_role"
  ADD CONSTRAINT "fk_app_user_role__granted_by_user_id__app_user"
  FOREIGN KEY ("granted_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."app_user_role" AS child
     WHERE child."role_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_role" AS parent
          WHERE parent."role_id" = child."role_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_app_user_role__role_id__app_role';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."app_user_role"
  ADD CONSTRAINT "fk_app_user_role__role_id__app_role"
  FOREIGN KEY ("role_id")
  REFERENCES public."app_role" ("role_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."app_user_role" AS child
     WHERE child."user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_app_user_role__user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."app_user_role"
  ADD CONSTRAINT "fk_app_user_role__user_id__app_user"
  FOREIGN KEY ("user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."cost_card_material_price" AS child
     WHERE child."approved_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."approved_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_cost_card_material_price__approved_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."cost_card_material_price"
  ADD CONSTRAINT "fk_cost_card_material_price__approved_by_user_id__app_user"
  FOREIGN KEY ("approved_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."cost_card_material_price" AS child
     WHERE child."created_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."created_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_cost_card_material_price__created_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."cost_card_material_price"
  ADD CONSTRAINT "fk_cost_card_material_price__created_by_user_id__app_user"
  FOREIGN KEY ("created_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."cost_card_material_price" AS child
     WHERE child."location_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_location" AS parent
          WHERE parent."location_id" = child."location_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_cost_card_material_price__location_id__ops_location';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."cost_card_material_price"
  ADD CONSTRAINT "fk_cost_card_material_price__location_id__ops_location"
  FOREIGN KEY ("location_id")
  REFERENCES public."ops_location" ("location_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."cost_card_material_price" AS child
     WHERE child."material_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."scm_material" AS parent
          WHERE parent."material_id" = child."material_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_cost_card_material_price__material_id__scm_material';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."cost_card_material_price"
  ADD CONSTRAINT "fk_cost_card_material_price__material_id__scm_material"
  FOREIGN KEY ("material_id")
  REFERENCES public."scm_material" ("material_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."cost_card_material_price" AS child
     WHERE child."supplier_price_observation_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."scm_supplier_price_observation" AS parent
          WHERE parent."supplier_price_observation_id" = child."supplier_price_observation_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_cost_card_material_price__supplier_price_observat_000665e359';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."cost_card_material_price"
  ADD CONSTRAINT "fk_cost_card_material_price__supplier_price_observat_000665e359"
  FOREIGN KEY ("supplier_price_observation_id")
  REFERENCES public."scm_supplier_price_observation" ("supplier_price_observation_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."cost_card_recipe_component" AS child
     WHERE child."input_unit_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_unit" AS parent
          WHERE parent."unit_id" = child."input_unit_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_cost_card_recipe_component__input_unit_id__app_unit';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."cost_card_recipe_component"
  ADD CONSTRAINT "fk_cost_card_recipe_component__input_unit_id__app_unit"
  FOREIGN KEY ("input_unit_id")
  REFERENCES public."app_unit" ("unit_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."cost_card_recipe_component" AS child
     WHERE child."material_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."scm_material" AS parent
          WHERE parent."material_id" = child."material_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_cost_card_recipe_component__material_id__scm_material';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."cost_card_recipe_component"
  ADD CONSTRAINT "fk_cost_card_recipe_component__material_id__scm_material"
  FOREIGN KEY ("material_id")
  REFERENCES public."scm_material" ("material_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."cost_card_recipe_component" AS child
     WHERE child."material_unit_conversion_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."scm_material_unit_conversion" AS parent
          WHERE parent."material_unit_conversion_id" = child."material_unit_conversion_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_cost_card_recipe_component__material_unit_convers_0a757a1b6b';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."cost_card_recipe_component"
  ADD CONSTRAINT "fk_cost_card_recipe_component__material_unit_convers_0a757a1b6b"
  FOREIGN KEY ("material_unit_conversion_id")
  REFERENCES public."scm_material_unit_conversion" ("material_unit_conversion_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."cost_card_recipe_component" AS child
     WHERE child."recipe_version_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."cost_card_recipe_version" AS parent
          WHERE parent."recipe_version_id" = child."recipe_version_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_cost_card_recipe_component__recipe_version_id__co_516556b847';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."cost_card_recipe_component"
  ADD CONSTRAINT "fk_cost_card_recipe_component__recipe_version_id__co_516556b847"
  FOREIGN KEY ("recipe_version_id")
  REFERENCES public."cost_card_recipe_version" ("recipe_version_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."cost_card_recipe_version" AS child
     WHERE child."approved_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."approved_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_cost_card_recipe_version__approved_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."cost_card_recipe_version"
  ADD CONSTRAINT "fk_cost_card_recipe_version__approved_by_user_id__app_user"
  FOREIGN KEY ("approved_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."cost_card_recipe_version" AS child
     WHERE child."created_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."created_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_cost_card_recipe_version__created_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."cost_card_recipe_version"
  ADD CONSTRAINT "fk_cost_card_recipe_version__created_by_user_id__app_user"
  FOREIGN KEY ("created_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."cost_card_recipe_version" AS child
     WHERE child."output_material_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."scm_material" AS parent
          WHERE parent."material_id" = child."output_material_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_cost_card_recipe_version__output_material_id__scm_material';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."cost_card_recipe_version"
  ADD CONSTRAINT "fk_cost_card_recipe_version__output_material_id__scm_material"
  FOREIGN KEY ("output_material_id")
  REFERENCES public."scm_material" ("material_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."cost_card_recipe_version" AS child
     WHERE child."output_product_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_product" AS parent
          WHERE parent."product_id" = child."output_product_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_cost_card_recipe_version__output_product_id__ops_product';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."cost_card_recipe_version"
  ADD CONSTRAINT "fk_cost_card_recipe_version__output_product_id__ops_product"
  FOREIGN KEY ("output_product_id")
  REFERENCES public."ops_product" ("product_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."cost_card_recipe_version" AS child
     WHERE child."yield_unit_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_unit" AS parent
          WHERE parent."unit_id" = child."yield_unit_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_cost_card_recipe_version__yield_unit_id__app_unit';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."cost_card_recipe_version"
  ADD CONSTRAINT "fk_cost_card_recipe_version__yield_unit_id__app_unit"
  FOREIGN KEY ("yield_unit_id")
  REFERENCES public."app_unit" ("unit_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."finance_cashflow_line" AS child
     WHERE child."finance_import_batch_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."finance_import_batch" AS parent
          WHERE parent."finance_import_batch_id" = child."finance_import_batch_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_finance_cashflow_line__finance_import_batch_id__f_1d67af41d6';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."finance_cashflow_line"
  ADD CONSTRAINT "fk_finance_cashflow_line__finance_import_batch_id__f_1d67af41d6"
  FOREIGN KEY ("finance_import_batch_id")
  REFERENCES public."finance_import_batch" ("finance_import_batch_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."finance_cashflow_line" AS child
     WHERE child."location_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_location" AS parent
          WHERE parent."location_id" = child."location_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_finance_cashflow_line__location_id__ops_location';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."finance_cashflow_line"
  ADD CONSTRAINT "fk_finance_cashflow_line__location_id__ops_location"
  FOREIGN KEY ("location_id")
  REFERENCES public."ops_location" ("location_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."finance_import_batch" AS child
     WHERE child."approved_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."approved_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_finance_import_batch__approved_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."finance_import_batch"
  ADD CONSTRAINT "fk_finance_import_batch__approved_by_user_id__app_user"
  FOREIGN KEY ("approved_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."finance_import_batch" AS child
     WHERE child."created_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."created_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_finance_import_batch__created_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."finance_import_batch"
  ADD CONSTRAINT "fk_finance_import_batch__created_by_user_id__app_user"
  FOREIGN KEY ("created_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."finance_import_batch" AS child
     WHERE child."job_run_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_job_run" AS parent
          WHERE parent."job_run_id" = child."job_run_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_finance_import_batch__job_run_id__app_job_run';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."finance_import_batch"
  ADD CONSTRAINT "fk_finance_import_batch__job_run_id__app_job_run"
  FOREIGN KEY ("job_run_id")
  REFERENCES public."app_job_run" ("job_run_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."finance_import_batch" AS child
     WHERE child."scope_location_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_location" AS parent
          WHERE parent."location_id" = child."scope_location_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_finance_import_batch__scope_location_id__ops_location';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."finance_import_batch"
  ADD CONSTRAINT "fk_finance_import_batch__scope_location_id__ops_location"
  FOREIGN KEY ("scope_location_id")
  REFERENCES public."ops_location" ("location_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."finance_import_batch" AS child
     WHERE child."source_system_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_source_system" AS parent
          WHERE parent."source_system_id" = child."source_system_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_finance_import_batch__source_system_id__app_source_system';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."finance_import_batch"
  ADD CONSTRAINT "fk_finance_import_batch__source_system_id__app_source_system"
  FOREIGN KEY ("source_system_id")
  REFERENCES public."app_source_system" ("source_system_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."finance_import_batch" AS child
     WHERE child."supersedes_finance_import_batch_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."finance_import_batch" AS parent
          WHERE parent."finance_import_batch_id" = child."supersedes_finance_import_batch_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_finance_import_batch__supersedes_finance_import_b_6948db62cb';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."finance_import_batch"
  ADD CONSTRAINT "fk_finance_import_batch__supersedes_finance_import_b_6948db62cb"
  FOREIGN KEY ("supersedes_finance_import_batch_id")
  REFERENCES public."finance_import_batch" ("finance_import_batch_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."finance_inventory_flow_line" AS child
     WHERE child."finance_import_batch_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."finance_import_batch" AS parent
          WHERE parent."finance_import_batch_id" = child."finance_import_batch_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_finance_inventory_flow_line__finance_import_batch_29465f989c';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."finance_inventory_flow_line"
  ADD CONSTRAINT "fk_finance_inventory_flow_line__finance_import_batch_29465f989c"
  FOREIGN KEY ("finance_import_batch_id")
  REFERENCES public."finance_import_batch" ("finance_import_batch_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."finance_inventory_flow_line" AS child
     WHERE child."location_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_location" AS parent
          WHERE parent."location_id" = child."location_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_finance_inventory_flow_line__location_id__ops_location';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."finance_inventory_flow_line"
  ADD CONSTRAINT "fk_finance_inventory_flow_line__location_id__ops_location"
  FOREIGN KEY ("location_id")
  REFERENCES public."ops_location" ("location_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."finance_inventory_flow_line" AS child
     WHERE child."material_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."scm_material" AS parent
          WHERE parent."material_id" = child."material_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_finance_inventory_flow_line__material_id__scm_material';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."finance_inventory_flow_line"
  ADD CONSTRAINT "fk_finance_inventory_flow_line__material_id__scm_material"
  FOREIGN KEY ("material_id")
  REFERENCES public."scm_material" ("material_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."finance_inventory_snapshot_line" AS child
     WHERE child."finance_import_batch_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."finance_import_batch" AS parent
          WHERE parent."finance_import_batch_id" = child."finance_import_batch_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_finance_inventory_snapshot_line__finance_import_b_06c6a8acb4';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."finance_inventory_snapshot_line"
  ADD CONSTRAINT "fk_finance_inventory_snapshot_line__finance_import_b_06c6a8acb4"
  FOREIGN KEY ("finance_import_batch_id")
  REFERENCES public."finance_import_batch" ("finance_import_batch_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."finance_inventory_snapshot_line" AS child
     WHERE child."location_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_location" AS parent
          WHERE parent."location_id" = child."location_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_finance_inventory_snapshot_line__location_id__ops_location';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."finance_inventory_snapshot_line"
  ADD CONSTRAINT "fk_finance_inventory_snapshot_line__location_id__ops_location"
  FOREIGN KEY ("location_id")
  REFERENCES public."ops_location" ("location_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."finance_inventory_snapshot_line" AS child
     WHERE child."material_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."scm_material" AS parent
          WHERE parent."material_id" = child."material_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_finance_inventory_snapshot_line__material_id__scm_material';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."finance_inventory_snapshot_line"
  ADD CONSTRAINT "fk_finance_inventory_snapshot_line__material_id__scm_material"
  FOREIGN KEY ("material_id")
  REFERENCES public."scm_material" ("material_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."finance_item_sales_monthly" AS child
     WHERE child."finance_import_batch_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."finance_import_batch" AS parent
          WHERE parent."finance_import_batch_id" = child."finance_import_batch_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_finance_item_sales_monthly__finance_import_batch__45d8b25481';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."finance_item_sales_monthly"
  ADD CONSTRAINT "fk_finance_item_sales_monthly__finance_import_batch__45d8b25481"
  FOREIGN KEY ("finance_import_batch_id")
  REFERENCES public."finance_import_batch" ("finance_import_batch_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."finance_item_sales_monthly" AS child
     WHERE child."location_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_location" AS parent
          WHERE parent."location_id" = child."location_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_finance_item_sales_monthly__location_id__ops_location';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."finance_item_sales_monthly"
  ADD CONSTRAINT "fk_finance_item_sales_monthly__location_id__ops_location"
  FOREIGN KEY ("location_id")
  REFERENCES public."ops_location" ("location_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."finance_item_sales_monthly" AS child
     WHERE child."product_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_product" AS parent
          WHERE parent."product_id" = child."product_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_finance_item_sales_monthly__product_id__ops_product';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."finance_item_sales_monthly"
  ADD CONSTRAINT "fk_finance_item_sales_monthly__product_id__ops_product"
  FOREIGN KEY ("product_id")
  REFERENCES public."ops_product" ("product_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."finance_monthly_cost_line" AS child
     WHERE child."finance_import_batch_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."finance_import_batch" AS parent
          WHERE parent."finance_import_batch_id" = child."finance_import_batch_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_finance_monthly_cost_line__finance_import_batch_i_6f868f5631';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."finance_monthly_cost_line"
  ADD CONSTRAINT "fk_finance_monthly_cost_line__finance_import_batch_i_6f868f5631"
  FOREIGN KEY ("finance_import_batch_id")
  REFERENCES public."finance_import_batch" ("finance_import_batch_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."finance_monthly_cost_line" AS child
     WHERE child."location_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_location" AS parent
          WHERE parent."location_id" = child."location_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_finance_monthly_cost_line__location_id__ops_location';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."finance_monthly_cost_line"
  ADD CONSTRAINT "fk_finance_monthly_cost_line__location_id__ops_location"
  FOREIGN KEY ("location_id")
  REFERENCES public."ops_location" ("location_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."finance_monthly_metric" AS child
     WHERE child."finance_import_batch_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."finance_import_batch" AS parent
          WHERE parent."finance_import_batch_id" = child."finance_import_batch_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_finance_monthly_metric__finance_import_batch_id___c3e99b5a59';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."finance_monthly_metric"
  ADD CONSTRAINT "fk_finance_monthly_metric__finance_import_batch_id___c3e99b5a59"
  FOREIGN KEY ("finance_import_batch_id")
  REFERENCES public."finance_import_batch" ("finance_import_batch_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."finance_monthly_metric" AS child
     WHERE child."location_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_location" AS parent
          WHERE parent."location_id" = child."location_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_finance_monthly_metric__location_id__ops_location';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."finance_monthly_metric"
  ADD CONSTRAINT "fk_finance_monthly_metric__location_id__ops_location"
  FOREIGN KEY ("location_id")
  REFERENCES public."ops_location" ("location_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."finance_order_logistics_line" AS child
     WHERE child."finance_import_batch_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."finance_import_batch" AS parent
          WHERE parent."finance_import_batch_id" = child."finance_import_batch_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_finance_order_logistics_line__finance_import_batc_fdd686e933';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."finance_order_logistics_line"
  ADD CONSTRAINT "fk_finance_order_logistics_line__finance_import_batc_fdd686e933"
  FOREIGN KEY ("finance_import_batch_id")
  REFERENCES public."finance_import_batch" ("finance_import_batch_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."finance_order_logistics_line" AS child
     WHERE child."location_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_location" AS parent
          WHERE parent."location_id" = child."location_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_finance_order_logistics_line__location_id__ops_location';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."finance_order_logistics_line"
  ADD CONSTRAINT "fk_finance_order_logistics_line__location_id__ops_location"
  FOREIGN KEY ("location_id")
  REFERENCES public."ops_location" ("location_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."finance_order_logistics_line" AS child
     WHERE child."material_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."scm_material" AS parent
          WHERE parent."material_id" = child."material_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_finance_order_logistics_line__material_id__scm_material';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."finance_order_logistics_line"
  ADD CONSTRAINT "fk_finance_order_logistics_line__material_id__scm_material"
  FOREIGN KEY ("material_id")
  REFERENCES public."scm_material" ("material_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."finance_order_logistics_line" AS child
     WHERE child."supplier_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."scm_supplier" AS parent
          WHERE parent."supplier_id" = child."supplier_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_finance_order_logistics_line__supplier_id__scm_supplier';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."finance_order_logistics_line"
  ADD CONSTRAINT "fk_finance_order_logistics_line__supplier_id__scm_supplier"
  FOREIGN KEY ("supplier_id")
  REFERENCES public."scm_supplier" ("supplier_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."finance_period_category_map" AS child
     WHERE child."approved_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."approved_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_finance_period_category_map__approved_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."finance_period_category_map"
  ADD CONSTRAINT "fk_finance_period_category_map__approved_by_user_id__app_user"
  FOREIGN KEY ("approved_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."finance_period_category_map" AS child
     WHERE child."created_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."created_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_finance_period_category_map__created_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."finance_period_category_map"
  ADD CONSTRAINT "fk_finance_period_category_map__created_by_user_id__app_user"
  FOREIGN KEY ("created_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."finance_sales_daily" AS child
     WHERE child."finance_import_batch_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."finance_import_batch" AS parent
          WHERE parent."finance_import_batch_id" = child."finance_import_batch_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_finance_sales_daily__finance_import_batch_id__fin_8b0c338b63';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."finance_sales_daily"
  ADD CONSTRAINT "fk_finance_sales_daily__finance_import_batch_id__fin_8b0c338b63"
  FOREIGN KEY ("finance_import_batch_id")
  REFERENCES public."finance_import_batch" ("finance_import_batch_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."finance_sales_daily" AS child
     WHERE child."location_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_location" AS parent
          WHERE parent."location_id" = child."location_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_finance_sales_daily__location_id__ops_location';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."finance_sales_daily"
  ADD CONSTRAINT "fk_finance_sales_daily__location_id__ops_location"
  FOREIGN KEY ("location_id")
  REFERENCES public."ops_location" ("location_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."finance_supplier_purchase_monthly" AS child
     WHERE child."finance_import_batch_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."finance_import_batch" AS parent
          WHERE parent."finance_import_batch_id" = child."finance_import_batch_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_finance_supplier_purchase_monthly__finance_import_f07243d123';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."finance_supplier_purchase_monthly"
  ADD CONSTRAINT "fk_finance_supplier_purchase_monthly__finance_import_f07243d123"
  FOREIGN KEY ("finance_import_batch_id")
  REFERENCES public."finance_import_batch" ("finance_import_batch_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."finance_supplier_purchase_monthly" AS child
     WHERE child."location_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_location" AS parent
          WHERE parent."location_id" = child."location_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_finance_supplier_purchase_monthly__location_id__ops_location';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."finance_supplier_purchase_monthly"
  ADD CONSTRAINT "fk_finance_supplier_purchase_monthly__location_id__ops_location"
  FOREIGN KEY ("location_id")
  REFERENCES public."ops_location" ("location_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."finance_supplier_purchase_monthly" AS child
     WHERE child."material_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."scm_material" AS parent
          WHERE parent."material_id" = child."material_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_finance_supplier_purchase_monthly__material_id__scm_material';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."finance_supplier_purchase_monthly"
  ADD CONSTRAINT "fk_finance_supplier_purchase_monthly__material_id__scm_material"
  FOREIGN KEY ("material_id")
  REFERENCES public."scm_material" ("material_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."finance_supplier_purchase_monthly" AS child
     WHERE child."supplier_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."scm_supplier" AS parent
          WHERE parent."supplier_id" = child."supplier_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_finance_supplier_purchase_monthly__supplier_id__scm_supplier';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."finance_supplier_purchase_monthly"
  ADD CONSTRAINT "fk_finance_supplier_purchase_monthly__supplier_id__scm_supplier"
  FOREIGN KEY ("supplier_id")
  REFERENCES public."scm_supplier" ("supplier_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."finance_target" AS child
     WHERE child."approved_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."approved_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_finance_target__approved_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."finance_target"
  ADD CONSTRAINT "fk_finance_target__approved_by_user_id__app_user"
  FOREIGN KEY ("approved_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."finance_target" AS child
     WHERE child."created_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."created_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_finance_target__created_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."finance_target"
  ADD CONSTRAINT "fk_finance_target__created_by_user_id__app_user"
  FOREIGN KEY ("created_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."finance_target" AS child
     WHERE child."location_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_location" AS parent
          WHERE parent."location_id" = child."location_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_finance_target__location_id__ops_location';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."finance_target"
  ADD CONSTRAINT "fk_finance_target__location_id__ops_location"
  FOREIGN KEY ("location_id")
  REFERENCES public."ops_location" ("location_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_application" AS child
     WHERE child."created_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."created_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_application__created_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_application"
  ADD CONSTRAINT "fk_hr_application__created_by_user_id__app_user"
  FOREIGN KEY ("created_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_application" AS child
     WHERE child."job_requisition_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."hr_job_requisition" AS parent
          WHERE parent."job_requisition_id" = child."job_requisition_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_application__job_requisition_id__hr_job_requisition';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_application"
  ADD CONSTRAINT "fk_hr_application__job_requisition_id__hr_job_requisition"
  FOREIGN KEY ("job_requisition_id")
  REFERENCES public."hr_job_requisition" ("job_requisition_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_application" AS child
     WHERE child."person_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."hr_person" AS parent
          WHERE parent."person_id" = child."person_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_application__person_id__hr_person';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_application"
  ADD CONSTRAINT "fk_hr_application__person_id__hr_person"
  FOREIGN KEY ("person_id")
  REFERENCES public."hr_person" ("person_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_application" AS child
     WHERE child."source_system_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_source_system" AS parent
          WHERE parent."source_system_id" = child."source_system_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_application__source_system_id__app_source_system';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_application"
  ADD CONSTRAINT "fk_hr_application__source_system_id__app_source_system"
  FOREIGN KEY ("source_system_id")
  REFERENCES public."app_source_system" ("source_system_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_application_stage_event" AS child
     WHERE child."actor_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."actor_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_application_stage_event__actor_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_application_stage_event"
  ADD CONSTRAINT "fk_hr_application_stage_event__actor_user_id__app_user"
  FOREIGN KEY ("actor_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_application_stage_event" AS child
     WHERE child."application_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."hr_application" AS parent
          WHERE parent."application_id" = child."application_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_application_stage_event__application_id__hr_application';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_application_stage_event"
  ADD CONSTRAINT "fk_hr_application_stage_event__application_id__hr_application"
  FOREIGN KEY ("application_id")
  REFERENCES public."hr_application" ("application_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_application_stage_event" AS child
     WHERE child."job_run_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_job_run" AS parent
          WHERE parent."job_run_id" = child."job_run_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_application_stage_event__job_run_id__app_job_run';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_application_stage_event"
  ADD CONSTRAINT "fk_hr_application_stage_event__job_run_id__app_job_run"
  FOREIGN KEY ("job_run_id")
  REFERENCES public."app_job_run" ("job_run_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_application_stage_event" AS child
     WHERE child."source_system_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_source_system" AS parent
          WHERE parent."source_system_id" = child."source_system_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_application_stage_event__source_system_id__app_094e2f700f';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_application_stage_event"
  ADD CONSTRAINT "fk_hr_application_stage_event__source_system_id__app_094e2f700f"
  FOREIGN KEY ("source_system_id")
  REFERENCES public."app_source_system" ("source_system_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_appointment" AS child
     WHERE child."application_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."hr_application" AS parent
          WHERE parent."application_id" = child."application_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_appointment__application_id__hr_application';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_appointment"
  ADD CONSTRAINT "fk_hr_appointment__application_id__hr_application"
  FOREIGN KEY ("application_id")
  REFERENCES public."hr_application" ("application_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_appointment" AS child
     WHERE child."confirmed_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."confirmed_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_appointment__confirmed_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_appointment"
  ADD CONSTRAINT "fk_hr_appointment__confirmed_by_user_id__app_user"
  FOREIGN KEY ("confirmed_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_appointment" AS child
     WHERE child."created_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."created_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_appointment__created_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_appointment"
  ADD CONSTRAINT "fk_hr_appointment__created_by_user_id__app_user"
  FOREIGN KEY ("created_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_appointment" AS child
     WHERE child."location_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_location" AS parent
          WHERE parent."location_id" = child."location_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_appointment__location_id__ops_location';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_appointment"
  ADD CONSTRAINT "fk_hr_appointment__location_id__ops_location"
  FOREIGN KEY ("location_id")
  REFERENCES public."ops_location" ("location_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_assessment" AS child
     WHERE child."application_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."hr_application" AS parent
          WHERE parent."application_id" = child."application_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_assessment__application_id__hr_application';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_assessment"
  ADD CONSTRAINT "fk_hr_assessment__application_id__hr_application"
  FOREIGN KEY ("application_id")
  REFERENCES public."hr_application" ("application_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_assessment" AS child
     WHERE child."appointment_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."hr_appointment" AS parent
          WHERE parent."appointment_id" = child."appointment_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_assessment__appointment_id__hr_appointment';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_assessment"
  ADD CONSTRAINT "fk_hr_assessment__appointment_id__hr_appointment"
  FOREIGN KEY ("appointment_id")
  REFERENCES public."hr_appointment" ("appointment_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_assessment" AS child
     WHERE child."assessor_employment_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."hr_employment" AS parent
          WHERE parent."employment_id" = child."assessor_employment_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_assessment__assessor_employment_id__hr_employment';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_assessment"
  ADD CONSTRAINT "fk_hr_assessment__assessor_employment_id__hr_employment"
  FOREIGN KEY ("assessor_employment_id")
  REFERENCES public."hr_employment" ("employment_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_assessment_score" AS child
     WHERE child."assessment_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."hr_assessment" AS parent
          WHERE parent."assessment_id" = child."assessment_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_assessment_score__assessment_id__hr_assessment';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_assessment_score"
  ADD CONSTRAINT "fk_hr_assessment_score__assessment_id__hr_assessment"
  FOREIGN KEY ("assessment_id")
  REFERENCES public."hr_assessment" ("assessment_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_employee_event" AS child
     WHERE child."employment_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."hr_employment" AS parent
          WHERE parent."employment_id" = child."employment_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_employee_event__employment_id__hr_employment';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_employee_event"
  ADD CONSTRAINT "fk_hr_employee_event__employment_id__hr_employment"
  FOREIGN KEY ("employment_id")
  REFERENCES public."hr_employment" ("employment_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_employee_event" AS child
     WHERE child."from_location_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_location" AS parent
          WHERE parent."location_id" = child."from_location_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_employee_event__from_location_id__ops_location';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_employee_event"
  ADD CONSTRAINT "fk_hr_employee_event__from_location_id__ops_location"
  FOREIGN KEY ("from_location_id")
  REFERENCES public."ops_location" ("location_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_employee_event" AS child
     WHERE child."recorded_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."recorded_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_employee_event__recorded_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_employee_event"
  ADD CONSTRAINT "fk_hr_employee_event__recorded_by_user_id__app_user"
  FOREIGN KEY ("recorded_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_employee_event" AS child
     WHERE child."to_location_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_location" AS parent
          WHERE parent."location_id" = child."to_location_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_employee_event__to_location_id__ops_location';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_employee_event"
  ADD CONSTRAINT "fk_hr_employee_event__to_location_id__ops_location"
  FOREIGN KEY ("to_location_id")
  REFERENCES public."ops_location" ("location_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_employment" AS child
     WHERE child."created_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."created_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_employment__created_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_employment"
  ADD CONSTRAINT "fk_hr_employment__created_by_user_id__app_user"
  FOREIGN KEY ("created_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_employment" AS child
     WHERE child."home_location_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_location" AS parent
          WHERE parent."location_id" = child."home_location_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_employment__home_location_id__ops_location';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_employment"
  ADD CONSTRAINT "fk_hr_employment__home_location_id__ops_location"
  FOREIGN KEY ("home_location_id")
  REFERENCES public."ops_location" ("location_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_employment" AS child
     WHERE child."origin_application_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."hr_application" AS parent
          WHERE parent."application_id" = child."origin_application_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_employment__origin_application_id__hr_application';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_employment"
  ADD CONSTRAINT "fk_hr_employment__origin_application_id__hr_application"
  FOREIGN KEY ("origin_application_id")
  REFERENCES public."hr_application" ("application_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_employment" AS child
     WHERE child."person_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."hr_person" AS parent
          WHERE parent."person_id" = child."person_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_employment__person_id__hr_person';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_employment"
  ADD CONSTRAINT "fk_hr_employment__person_id__hr_person"
  FOREIGN KEY ("person_id")
  REFERENCES public."hr_person" ("person_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_employment_mapping_review" AS child
     WHERE child."candidate_employment_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."hr_employment" AS parent
          WHERE parent."employment_id" = child."candidate_employment_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_employment_mapping_review__candidate_employmen_3a1bc94aaf';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_employment_mapping_review"
  ADD CONSTRAINT "fk_hr_employment_mapping_review__candidate_employmen_3a1bc94aaf"
  FOREIGN KEY ("candidate_employment_id")
  REFERENCES public."hr_employment" ("employment_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_employment_mapping_review" AS child
     WHERE child."candidate_person_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."hr_person" AS parent
          WHERE parent."person_id" = child."candidate_person_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_employment_mapping_review__candidate_person_id__hr_person';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_employment_mapping_review"
  ADD CONSTRAINT "fk_hr_employment_mapping_review__candidate_person_id__hr_person"
  FOREIGN KEY ("candidate_person_id")
  REFERENCES public."hr_person" ("person_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_employment_mapping_review" AS child
     WHERE child."confirmed_source_identity_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."hr_employment_source_identity" AS parent
          WHERE parent."employment_source_identity_id" = child."confirmed_source_identity_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_employment_mapping_review__confirmed_source_id_8743c847e7';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_employment_mapping_review"
  ADD CONSTRAINT "fk_hr_employment_mapping_review__confirmed_source_id_8743c847e7"
  FOREIGN KEY ("confirmed_source_identity_id")
  REFERENCES public."hr_employment_source_identity" ("employment_source_identity_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_employment_mapping_review" AS child
     WHERE child."created_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."created_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_employment_mapping_review__created_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_employment_mapping_review"
  ADD CONSTRAINT "fk_hr_employment_mapping_review__created_by_user_id__app_user"
  FOREIGN KEY ("created_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_employment_mapping_review" AS child
     WHERE child."reviewed_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."reviewed_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_employment_mapping_review__reviewed_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_employment_mapping_review"
  ADD CONSTRAINT "fk_hr_employment_mapping_review__reviewed_by_user_id__app_user"
  FOREIGN KEY ("reviewed_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_employment_mapping_review" AS child
     WHERE child."source_system_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_source_system" AS parent
          WHERE parent."source_system_id" = child."source_system_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_employment_mapping_review__source_system_id__a_b8c0c5d798';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_employment_mapping_review"
  ADD CONSTRAINT "fk_hr_employment_mapping_review__source_system_id__a_b8c0c5d798"
  FOREIGN KEY ("source_system_id")
  REFERENCES public."app_source_system" ("source_system_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_employment_source_identity" AS child
     WHERE child."created_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."created_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_employment_source_identity__created_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_employment_source_identity"
  ADD CONSTRAINT "fk_hr_employment_source_identity__created_by_user_id__app_user"
  FOREIGN KEY ("created_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_employment_source_identity" AS child
     WHERE child."employment_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."hr_employment" AS parent
          WHERE parent."employment_id" = child."employment_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_employment_source_identity__employment_id__hr_employment';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_employment_source_identity"
  ADD CONSTRAINT "fk_hr_employment_source_identity__employment_id__hr_employment"
  FOREIGN KEY ("employment_id")
  REFERENCES public."hr_employment" ("employment_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_employment_source_identity" AS child
     WHERE child."source_system_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_source_system" AS parent
          WHERE parent."source_system_id" = child."source_system_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_employment_source_identity__source_system_id___5b5fef6902';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_employment_source_identity"
  ADD CONSTRAINT "fk_hr_employment_source_identity__source_system_id___5b5fef6902"
  FOREIGN KEY ("source_system_id")
  REFERENCES public."app_source_system" ("source_system_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_job_requisition" AS child
     WHERE child."approved_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."approved_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_job_requisition__approved_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_job_requisition"
  ADD CONSTRAINT "fk_hr_job_requisition__approved_by_user_id__app_user"
  FOREIGN KEY ("approved_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_job_requisition" AS child
     WHERE child."created_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."created_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_job_requisition__created_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_job_requisition"
  ADD CONSTRAINT "fk_hr_job_requisition__created_by_user_id__app_user"
  FOREIGN KEY ("created_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_job_requisition" AS child
     WHERE child."location_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_location" AS parent
          WHERE parent."location_id" = child."location_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_job_requisition__location_id__ops_location';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_job_requisition"
  ADD CONSTRAINT "fk_hr_job_requisition__location_id__ops_location"
  FOREIGN KEY ("location_id")
  REFERENCES public."ops_location" ("location_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_job_requisition" AS child
     WHERE child."role_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_role" AS parent
          WHERE parent."role_id" = child."role_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_job_requisition__role_id__ops_role';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_job_requisition"
  ADD CONSTRAINT "fk_hr_job_requisition__role_id__ops_role"
  FOREIGN KEY ("role_id")
  REFERENCES public."ops_role" ("role_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_offer" AS child
     WHERE child."application_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."hr_application" AS parent
          WHERE parent."application_id" = child."application_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_offer__application_id__hr_application';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_offer"
  ADD CONSTRAINT "fk_hr_offer__application_id__hr_application"
  FOREIGN KEY ("application_id")
  REFERENCES public."hr_application" ("application_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_offer" AS child
     WHERE child."created_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."created_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_offer__created_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_offer"
  ADD CONSTRAINT "fk_hr_offer__created_by_user_id__app_user"
  FOREIGN KEY ("created_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_offer" AS child
     WHERE child."location_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_location" AS parent
          WHERE parent."location_id" = child."location_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_offer__location_id__ops_location';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_offer"
  ADD CONSTRAINT "fk_hr_offer__location_id__ops_location"
  FOREIGN KEY ("location_id")
  REFERENCES public."ops_location" ("location_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_offer" AS child
     WHERE child."role_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_role" AS parent
          WHERE parent."role_id" = child."role_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_offer__role_id__ops_role';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_offer"
  ADD CONSTRAINT "fk_hr_offer__role_id__ops_role"
  FOREIGN KEY ("role_id")
  REFERENCES public."ops_role" ("role_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_offer" AS child
     WHERE child."supersedes_offer_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."hr_offer" AS parent
          WHERE parent."offer_id" = child."supersedes_offer_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_offer__supersedes_offer_id__hr_offer';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_offer"
  ADD CONSTRAINT "fk_hr_offer__supersedes_offer_id__hr_offer"
  FOREIGN KEY ("supersedes_offer_id")
  REFERENCES public."hr_offer" ("offer_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_person" AS child
     WHERE child."created_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."created_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_person__created_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_person"
  ADD CONSTRAINT "fk_hr_person__created_by_user_id__app_user"
  FOREIGN KEY ("created_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_person" AS child
     WHERE child."merged_into_person_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."hr_person" AS parent
          WHERE parent."person_id" = child."merged_into_person_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_person__merged_into_person_id__hr_person';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_person"
  ADD CONSTRAINT "fk_hr_person__merged_into_person_id__hr_person"
  FOREIGN KEY ("merged_into_person_id")
  REFERENCES public."hr_person" ("person_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_person_contact" AS child
     WHERE child."created_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."created_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_person_contact__created_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_person_contact"
  ADD CONSTRAINT "fk_hr_person_contact__created_by_user_id__app_user"
  FOREIGN KEY ("created_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_person_contact" AS child
     WHERE child."person_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."hr_person" AS parent
          WHERE parent."person_id" = child."person_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_person_contact__person_id__hr_person';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_person_contact"
  ADD CONSTRAINT "fk_hr_person_contact__person_id__hr_person"
  FOREIGN KEY ("person_id")
  REFERENCES public."hr_person" ("person_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_screening_rule" AS child
     WHERE child."approved_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."approved_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_screening_rule__approved_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_screening_rule"
  ADD CONSTRAINT "fk_hr_screening_rule__approved_by_user_id__app_user"
  FOREIGN KEY ("approved_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_screening_rule" AS child
     WHERE child."created_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."created_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_screening_rule__created_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_screening_rule"
  ADD CONSTRAINT "fk_hr_screening_rule__created_by_user_id__app_user"
  FOREIGN KEY ("created_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."hr_screening_rule" AS child
     WHERE child."role_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_role" AS parent
          WHERE parent."role_id" = child."role_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_hr_screening_rule__role_id__ops_role';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."hr_screening_rule"
  ADD CONSTRAINT "fk_hr_screening_rule__role_id__ops_role"
  FOREIGN KEY ("role_id")
  REFERENCES public."ops_role" ("role_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."mkt_campaign_member" AS child
     WHERE child."campaign_version_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."mkt_campaign_version" AS parent
          WHERE parent."campaign_version_id" = child."campaign_version_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_mkt_campaign_member__campaign_version_id__mkt_cam_6490acf630';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."mkt_campaign_member"
  ADD CONSTRAINT "fk_mkt_campaign_member__campaign_version_id__mkt_cam_6490acf630"
  FOREIGN KEY ("campaign_version_id")
  REFERENCES public."mkt_campaign_version" ("campaign_version_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."mkt_campaign_member" AS child
     WHERE child."member_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."pos_member" AS parent
          WHERE parent."member_id" = child."member_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_mkt_campaign_member__member_id__pos_member';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."mkt_campaign_member"
  ADD CONSTRAINT "fk_mkt_campaign_member__member_id__pos_member"
  FOREIGN KEY ("member_id")
  REFERENCES public."pos_member" ("member_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."mkt_campaign_version" AS child
     WHERE child."approved_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."approved_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_mkt_campaign_version__approved_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."mkt_campaign_version"
  ADD CONSTRAINT "fk_mkt_campaign_version__approved_by_user_id__app_user"
  FOREIGN KEY ("approved_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."mkt_campaign_version" AS child
     WHERE child."created_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."created_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_mkt_campaign_version__created_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."mkt_campaign_version"
  ADD CONSTRAINT "fk_mkt_campaign_version__created_by_user_id__app_user"
  FOREIGN KEY ("created_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."mkt_campaign_version" AS child
     WHERE child."location_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_location" AS parent
          WHERE parent."location_id" = child."location_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_mkt_campaign_version__location_id__ops_location';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."mkt_campaign_version"
  ADD CONSTRAINT "fk_mkt_campaign_version__location_id__ops_location"
  FOREIGN KEY ("location_id")
  REFERENCES public."ops_location" ("location_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."mkt_reward" AS child
     WHERE child."created_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."created_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_mkt_reward__created_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."mkt_reward"
  ADD CONSTRAINT "fk_mkt_reward__created_by_user_id__app_user"
  FOREIGN KEY ("created_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."mkt_reward" AS child
     WHERE child."product_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_product" AS parent
          WHERE parent."product_id" = child."product_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_mkt_reward__product_id__ops_product';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."mkt_reward"
  ADD CONSTRAINT "fk_mkt_reward__product_id__ops_product"
  FOREIGN KEY ("product_id")
  REFERENCES public."ops_product" ("product_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."mkt_reward_claim" AS child
     WHERE child."campaign_member_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."mkt_campaign_member" AS parent
          WHERE parent."campaign_member_id" = child."campaign_member_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_mkt_reward_claim__campaign_member_id__mkt_campaign_member';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."mkt_reward_claim"
  ADD CONSTRAINT "fk_mkt_reward_claim__campaign_member_id__mkt_campaign_member"
  FOREIGN KEY ("campaign_member_id")
  REFERENCES public."mkt_campaign_member" ("campaign_member_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."mkt_reward_claim" AS child
     WHERE child."redeemed_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."redeemed_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_mkt_reward_claim__redeemed_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."mkt_reward_claim"
  ADD CONSTRAINT "fk_mkt_reward_claim__redeemed_by_user_id__app_user"
  FOREIGN KEY ("redeemed_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."mkt_reward_claim" AS child
     WHERE child."reward_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."mkt_reward" AS parent
          WHERE parent."reward_id" = child."reward_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_mkt_reward_claim__reward_id__mkt_reward';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."mkt_reward_claim"
  ADD CONSTRAINT "fk_mkt_reward_claim__reward_id__mkt_reward"
  FOREIGN KEY ("reward_id")
  REFERENCES public."mkt_reward" ("reward_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."mkt_reward_claim" AS child
     WHERE child."reward_stock_id" IS NOT NULL AND child."reward_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."mkt_reward_stock" AS parent
          WHERE parent."reward_stock_id" = child."reward_stock_id" AND parent."reward_id" = child."reward_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_mkt_reward_claim__reward_stock_id__reward_id__mkt_0f44d1b776';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."mkt_reward_claim"
  ADD CONSTRAINT "fk_mkt_reward_claim__reward_stock_id__reward_id__mkt_0f44d1b776"
  FOREIGN KEY ("reward_stock_id", "reward_id")
  REFERENCES public."mkt_reward_stock" ("reward_stock_id", "reward_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."mkt_reward_claim" AS child
     WHERE child."source_system_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_source_system" AS parent
          WHERE parent."source_system_id" = child."source_system_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_mkt_reward_claim__source_system_id__app_source_system';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."mkt_reward_claim"
  ADD CONSTRAINT "fk_mkt_reward_claim__source_system_id__app_source_system"
  FOREIGN KEY ("source_system_id")
  REFERENCES public."app_source_system" ("source_system_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."mkt_reward_claim" AS child
     WHERE child."survey_result_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."mkt_survey_result" AS parent
          WHERE parent."survey_result_id" = child."survey_result_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_mkt_reward_claim__survey_result_id__mkt_survey_result';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."mkt_reward_claim"
  ADD CONSTRAINT "fk_mkt_reward_claim__survey_result_id__mkt_survey_result"
  FOREIGN KEY ("survey_result_id")
  REFERENCES public."mkt_survey_result" ("survey_result_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."mkt_reward_stock" AS child
     WHERE child."campaign_version_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."mkt_campaign_version" AS parent
          WHERE parent."campaign_version_id" = child."campaign_version_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_mkt_reward_stock__campaign_version_id__mkt_campaign_version';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."mkt_reward_stock"
  ADD CONSTRAINT "fk_mkt_reward_stock__campaign_version_id__mkt_campaign_version"
  FOREIGN KEY ("campaign_version_id")
  REFERENCES public."mkt_campaign_version" ("campaign_version_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."mkt_reward_stock" AS child
     WHERE child."location_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_location" AS parent
          WHERE parent."location_id" = child."location_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_mkt_reward_stock__location_id__ops_location';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."mkt_reward_stock"
  ADD CONSTRAINT "fk_mkt_reward_stock__location_id__ops_location"
  FOREIGN KEY ("location_id")
  REFERENCES public."ops_location" ("location_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."mkt_reward_stock" AS child
     WHERE child."reward_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."mkt_reward" AS parent
          WHERE parent."reward_id" = child."reward_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_mkt_reward_stock__reward_id__mkt_reward';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."mkt_reward_stock"
  ADD CONSTRAINT "fk_mkt_reward_stock__reward_id__mkt_reward"
  FOREIGN KEY ("reward_id")
  REFERENCES public."mkt_reward" ("reward_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."mkt_survey_answer" AS child
     WHERE child."selected_option_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."mkt_survey_question_option" AS parent
          WHERE parent."survey_question_option_id" = child."selected_option_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_mkt_survey_answer__selected_option_id__mkt_survey_d81e145887';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."mkt_survey_answer"
  ADD CONSTRAINT "fk_mkt_survey_answer__selected_option_id__mkt_survey_d81e145887"
  FOREIGN KEY ("selected_option_id")
  REFERENCES public."mkt_survey_question_option" ("survey_question_option_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."mkt_survey_answer" AS child
     WHERE child."survey_question_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."mkt_survey_question" AS parent
          WHERE parent."survey_question_id" = child."survey_question_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_mkt_survey_answer__survey_question_id__mkt_survey_question';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."mkt_survey_answer"
  ADD CONSTRAINT "fk_mkt_survey_answer__survey_question_id__mkt_survey_question"
  FOREIGN KEY ("survey_question_id")
  REFERENCES public."mkt_survey_question" ("survey_question_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."mkt_survey_answer" AS child
     WHERE child."survey_response_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."mkt_survey_response" AS parent
          WHERE parent."survey_response_id" = child."survey_response_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_mkt_survey_answer__survey_response_id__mkt_survey_response';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."mkt_survey_answer"
  ADD CONSTRAINT "fk_mkt_survey_answer__survey_response_id__mkt_survey_response"
  FOREIGN KEY ("survey_response_id")
  REFERENCES public."mkt_survey_response" ("survey_response_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."mkt_survey_question" AS child
     WHERE child."campaign_version_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."mkt_campaign_version" AS parent
          WHERE parent."campaign_version_id" = child."campaign_version_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_mkt_survey_question__campaign_version_id__mkt_cam_fdad242e92';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."mkt_survey_question"
  ADD CONSTRAINT "fk_mkt_survey_question__campaign_version_id__mkt_cam_fdad242e92"
  FOREIGN KEY ("campaign_version_id")
  REFERENCES public."mkt_campaign_version" ("campaign_version_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."mkt_survey_question" AS child
     WHERE child."created_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."created_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_mkt_survey_question__created_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."mkt_survey_question"
  ADD CONSTRAINT "fk_mkt_survey_question__created_by_user_id__app_user"
  FOREIGN KEY ("created_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."mkt_survey_question_option" AS child
     WHERE child."created_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."created_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_mkt_survey_question_option__created_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."mkt_survey_question_option"
  ADD CONSTRAINT "fk_mkt_survey_question_option__created_by_user_id__app_user"
  FOREIGN KEY ("created_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."mkt_survey_question_option" AS child
     WHERE child."survey_question_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."mkt_survey_question" AS parent
          WHERE parent."survey_question_id" = child."survey_question_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_mkt_survey_question_option__survey_question_id__m_8fec50d6d9';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."mkt_survey_question_option"
  ADD CONSTRAINT "fk_mkt_survey_question_option__survey_question_id__m_8fec50d6d9"
  FOREIGN KEY ("survey_question_id")
  REFERENCES public."mkt_survey_question" ("survey_question_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."mkt_survey_response" AS child
     WHERE child."campaign_member_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."mkt_campaign_member" AS parent
          WHERE parent."campaign_member_id" = child."campaign_member_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_mkt_survey_response__campaign_member_id__mkt_campaign_member';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."mkt_survey_response"
  ADD CONSTRAINT "fk_mkt_survey_response__campaign_member_id__mkt_campaign_member"
  FOREIGN KEY ("campaign_member_id")
  REFERENCES public."mkt_campaign_member" ("campaign_member_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."mkt_survey_response" AS child
     WHERE child."source_system_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_source_system" AS parent
          WHERE parent."source_system_id" = child."source_system_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_mkt_survey_response__source_system_id__app_source_system';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."mkt_survey_response"
  ADD CONSTRAINT "fk_mkt_survey_response__source_system_id__app_source_system"
  FOREIGN KEY ("source_system_id")
  REFERENCES public."app_source_system" ("source_system_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."mkt_survey_result" AS child
     WHERE child."source_system_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_source_system" AS parent
          WHERE parent."source_system_id" = child."source_system_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_mkt_survey_result__source_system_id__app_source_system';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."mkt_survey_result"
  ADD CONSTRAINT "fk_mkt_survey_result__source_system_id__app_source_system"
  FOREIGN KEY ("source_system_id")
  REFERENCES public."app_source_system" ("source_system_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."mkt_survey_result" AS child
     WHERE child."survey_response_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."mkt_survey_response" AS parent
          WHERE parent."survey_response_id" = child."survey_response_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_mkt_survey_result__survey_response_id__mkt_survey_response';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."mkt_survey_result"
  ADD CONSTRAINT "fk_mkt_survey_result__survey_response_id__mkt_survey_response"
  FOREIGN KEY ("survey_response_id")
  REFERENCES public."mkt_survey_response" ("survey_response_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."msg_conversation" AS child
     WHERE child."app_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."app_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_msg_conversation__app_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."msg_conversation"
  ADD CONSTRAINT "fk_msg_conversation__app_user_id__app_user"
  FOREIGN KEY ("app_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."msg_conversation" AS child
     WHERE child."application_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."hr_application" AS parent
          WHERE parent."application_id" = child."application_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_msg_conversation__application_id__hr_application';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."msg_conversation"
  ADD CONSTRAINT "fk_msg_conversation__application_id__hr_application"
  FOREIGN KEY ("application_id")
  REFERENCES public."hr_application" ("application_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."msg_conversation" AS child
     WHERE child."member_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."pos_member" AS parent
          WHERE parent."member_id" = child."member_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_msg_conversation__member_id__pos_member';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."msg_conversation"
  ADD CONSTRAINT "fk_msg_conversation__member_id__pos_member"
  FOREIGN KEY ("member_id")
  REFERENCES public."pos_member" ("member_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."msg_conversation" AS child
     WHERE child."person_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."hr_person" AS parent
          WHERE parent."person_id" = child."person_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_msg_conversation__person_id__hr_person';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."msg_conversation"
  ADD CONSTRAINT "fk_msg_conversation__person_id__hr_person"
  FOREIGN KEY ("person_id")
  REFERENCES public."hr_person" ("person_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."msg_conversation_state" AS child
     WHERE child."conversation_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."msg_conversation" AS parent
          WHERE parent."conversation_id" = child."conversation_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_msg_conversation_state__conversation_id__msg_conversation';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."msg_conversation_state"
  ADD CONSTRAINT "fk_msg_conversation_state__conversation_id__msg_conversation"
  FOREIGN KEY ("conversation_id")
  REFERENCES public."msg_conversation" ("conversation_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."msg_delivery_attempt" AS child
     WHERE child."outbound_message_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."msg_outbound_message" AS parent
          WHERE parent."outbound_message_id" = child."outbound_message_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_msg_delivery_attempt__outbound_message_id__msg_ou_1394ded0da';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."msg_delivery_attempt"
  ADD CONSTRAINT "fk_msg_delivery_attempt__outbound_message_id__msg_ou_1394ded0da"
  FOREIGN KEY ("outbound_message_id")
  REFERENCES public."msg_outbound_message" ("outbound_message_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."msg_message" AS child
     WHERE child."conversation_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."msg_conversation" AS parent
          WHERE parent."conversation_id" = child."conversation_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_msg_message__conversation_id__msg_conversation';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."msg_message"
  ADD CONSTRAINT "fk_msg_message__conversation_id__msg_conversation"
  FOREIGN KEY ("conversation_id")
  REFERENCES public."msg_conversation" ("conversation_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."msg_message" AS child
     WHERE child."outbound_message_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."msg_outbound_message" AS parent
          WHERE parent."outbound_message_id" = child."outbound_message_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_msg_message__outbound_message_id__msg_outbound_message';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."msg_message"
  ADD CONSTRAINT "fk_msg_message__outbound_message_id__msg_outbound_message"
  FOREIGN KEY ("outbound_message_id")
  REFERENCES public."msg_outbound_message" ("outbound_message_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."msg_outbound_message" AS child
     WHERE child."ai_call_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ai_call" AS parent
          WHERE parent."ai_call_id" = child."ai_call_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_msg_outbound_message__ai_call_id__ai_call';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."msg_outbound_message"
  ADD CONSTRAINT "fk_msg_outbound_message__ai_call_id__ai_call"
  FOREIGN KEY ("ai_call_id")
  REFERENCES public."ai_call" ("ai_call_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."msg_outbound_message" AS child
     WHERE child."appointment_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."hr_appointment" AS parent
          WHERE parent."appointment_id" = child."appointment_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_msg_outbound_message__appointment_id__hr_appointment';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."msg_outbound_message"
  ADD CONSTRAINT "fk_msg_outbound_message__appointment_id__hr_appointment"
  FOREIGN KEY ("appointment_id")
  REFERENCES public."hr_appointment" ("appointment_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."msg_outbound_message" AS child
     WHERE child."campaign_member_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."mkt_campaign_member" AS parent
          WHERE parent."campaign_member_id" = child."campaign_member_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_msg_outbound_message__campaign_member_id__mkt_cam_deb34f729b';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."msg_outbound_message"
  ADD CONSTRAINT "fk_msg_outbound_message__campaign_member_id__mkt_cam_deb34f729b"
  FOREIGN KEY ("campaign_member_id")
  REFERENCES public."mkt_campaign_member" ("campaign_member_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."msg_outbound_message" AS child
     WHERE child."conversation_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."msg_conversation" AS parent
          WHERE parent."conversation_id" = child."conversation_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_msg_outbound_message__conversation_id__msg_conversation';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."msg_outbound_message"
  ADD CONSTRAINT "fk_msg_outbound_message__conversation_id__msg_conversation"
  FOREIGN KEY ("conversation_id")
  REFERENCES public."msg_conversation" ("conversation_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."msg_outbound_message" AS child
     WHERE child."job_run_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_job_run" AS parent
          WHERE parent."job_run_id" = child."job_run_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_msg_outbound_message__job_run_id__app_job_run';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."msg_outbound_message"
  ADD CONSTRAINT "fk_msg_outbound_message__job_run_id__app_job_run"
  FOREIGN KEY ("job_run_id")
  REFERENCES public."app_job_run" ("job_run_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."msg_outbound_message" AS child
     WHERE child."queued_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."queued_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_msg_outbound_message__queued_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."msg_outbound_message"
  ADD CONSTRAINT "fk_msg_outbound_message__queued_by_user_id__app_user"
  FOREIGN KEY ("queued_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."msg_outbound_message" AS child
     WHERE child."review_action_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_review_action" AS parent
          WHERE parent."review_action_id" = child."review_action_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_msg_outbound_message__review_action_id__ops_review_action';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."msg_outbound_message"
  ADD CONSTRAINT "fk_msg_outbound_message__review_action_id__ops_review_action"
  FOREIGN KEY ("review_action_id")
  REFERENCES public."ops_review_action" ("review_action_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_business_rule" AS child
     WHERE child."approved_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."approved_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_business_rule__approved_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_business_rule"
  ADD CONSTRAINT "fk_ops_business_rule__approved_by_user_id__app_user"
  FOREIGN KEY ("approved_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_business_rule" AS child
     WHERE child."created_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."created_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_business_rule__created_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_business_rule"
  ADD CONSTRAINT "fk_ops_business_rule__created_by_user_id__app_user"
  FOREIGN KEY ("created_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_business_rule" AS child
     WHERE child."scope_location_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_location" AS parent
          WHERE parent."location_id" = child."scope_location_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_business_rule__scope_location_id__ops_location';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_business_rule"
  ADD CONSTRAINT "fk_ops_business_rule__scope_location_id__ops_location"
  FOREIGN KEY ("scope_location_id")
  REFERENCES public."ops_location" ("location_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_business_rule" AS child
     WHERE child."scope_product_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_product" AS parent
          WHERE parent."product_id" = child."scope_product_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_business_rule__scope_product_id__ops_product';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_business_rule"
  ADD CONSTRAINT "fk_ops_business_rule__scope_product_id__ops_product"
  FOREIGN KEY ("scope_product_id")
  REFERENCES public."ops_product" ("product_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_calendar_event" AS child
     WHERE child."job_run_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_job_run" AS parent
          WHERE parent."job_run_id" = child."job_run_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_calendar_event__job_run_id__app_job_run';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_calendar_event"
  ADD CONSTRAINT "fk_ops_calendar_event__job_run_id__app_job_run"
  FOREIGN KEY ("job_run_id")
  REFERENCES public."app_job_run" ("job_run_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_daily_review" AS child
     WHERE child."ai_call_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ai_call" AS parent
          WHERE parent."ai_call_id" = child."ai_call_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_daily_review__ai_call_id__ai_call';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_daily_review"
  ADD CONSTRAINT "fk_ops_daily_review__ai_call_id__ai_call"
  FOREIGN KEY ("ai_call_id")
  REFERENCES public."ai_call" ("ai_call_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_daily_review" AS child
     WHERE child."approved_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."approved_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_daily_review__approved_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_daily_review"
  ADD CONSTRAINT "fk_ops_daily_review__approved_by_user_id__app_user"
  FOREIGN KEY ("approved_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_daily_review" AS child
     WHERE child."created_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."created_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_daily_review__created_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_daily_review"
  ADD CONSTRAINT "fk_ops_daily_review__created_by_user_id__app_user"
  FOREIGN KEY ("created_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_daily_review" AS child
     WHERE child."location_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_location" AS parent
          WHERE parent."location_id" = child."location_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_daily_review__location_id__ops_location';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_daily_review"
  ADD CONSTRAINT "fk_ops_daily_review__location_id__ops_location"
  FOREIGN KEY ("location_id")
  REFERENCES public."ops_location" ("location_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_forecast_line" AS child
     WHERE child."forecast_run_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_forecast_run" AS parent
          WHERE parent."forecast_run_id" = child."forecast_run_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_forecast_line__forecast_run_id__ops_forecast_run';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_forecast_line"
  ADD CONSTRAINT "fk_ops_forecast_line__forecast_run_id__ops_forecast_run"
  FOREIGN KEY ("forecast_run_id")
  REFERENCES public."ops_forecast_run" ("forecast_run_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_forecast_line" AS child
     WHERE child."product_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_product" AS parent
          WHERE parent."product_id" = child."product_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_forecast_line__product_id__ops_product';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_forecast_line"
  ADD CONSTRAINT "fk_ops_forecast_line__product_id__ops_product"
  FOREIGN KEY ("product_id")
  REFERENCES public."ops_product" ("product_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_forecast_run" AS child
     WHERE child."job_run_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_job_run" AS parent
          WHERE parent."job_run_id" = child."job_run_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_forecast_run__job_run_id__app_job_run';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_forecast_run"
  ADD CONSTRAINT "fk_ops_forecast_run__job_run_id__app_job_run"
  FOREIGN KEY ("job_run_id")
  REFERENCES public."app_job_run" ("job_run_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_forecast_run" AS child
     WHERE child."location_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_location" AS parent
          WHERE parent."location_id" = child."location_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_forecast_run__location_id__ops_location';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_forecast_run"
  ADD CONSTRAINT "fk_ops_forecast_run__location_id__ops_location"
  FOREIGN KEY ("location_id")
  REFERENCES public."ops_location" ("location_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_location" AS child
     WHERE child."parent_location_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_location" AS parent
          WHERE parent."location_id" = child."parent_location_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_location__parent_location_id__ops_location';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_location"
  ADD CONSTRAINT "fk_ops_location__parent_location_id__ops_location"
  FOREIGN KEY ("parent_location_id")
  REFERENCES public."ops_location" ("location_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_location_source_identity" AS child
     WHERE child."created_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."created_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_location_source_identity__created_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_location_source_identity"
  ADD CONSTRAINT "fk_ops_location_source_identity__created_by_user_id__app_user"
  FOREIGN KEY ("created_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_location_source_identity" AS child
     WHERE child."location_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_location" AS parent
          WHERE parent."location_id" = child."location_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_location_source_identity__location_id__ops_location';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_location_source_identity"
  ADD CONSTRAINT "fk_ops_location_source_identity__location_id__ops_location"
  FOREIGN KEY ("location_id")
  REFERENCES public."ops_location" ("location_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_location_source_identity" AS child
     WHERE child."source_system_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_source_system" AS parent
          WHERE parent."source_system_id" = child."source_system_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_location_source_identity__source_system_id__a_ec48b1e5f2';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_location_source_identity"
  ADD CONSTRAINT "fk_ops_location_source_identity__source_system_id__a_ec48b1e5f2"
  FOREIGN KEY ("source_system_id")
  REFERENCES public."app_source_system" ("source_system_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_operational_event" AS child
     WHERE child."created_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."created_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_operational_event__created_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_operational_event"
  ADD CONSTRAINT "fk_ops_operational_event__created_by_user_id__app_user"
  FOREIGN KEY ("created_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_operational_event" AS child
     WHERE child."location_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_location" AS parent
          WHERE parent."location_id" = child."location_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_operational_event__location_id__ops_location';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_operational_event"
  ADD CONSTRAINT "fk_ops_operational_event__location_id__ops_location"
  FOREIGN KEY ("location_id")
  REFERENCES public."ops_location" ("location_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_operational_event_product" AS child
     WHERE child."created_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."created_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_operational_event_product__created_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_operational_event_product"
  ADD CONSTRAINT "fk_ops_operational_event_product__created_by_user_id__app_user"
  FOREIGN KEY ("created_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_operational_event_product" AS child
     WHERE child."operational_event_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_operational_event" AS parent
          WHERE parent."operational_event_id" = child."operational_event_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_operational_event_product__operational_event__b79406f832';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_operational_event_product"
  ADD CONSTRAINT "fk_ops_operational_event_product__operational_event__b79406f832"
  FOREIGN KEY ("operational_event_id")
  REFERENCES public."ops_operational_event" ("operational_event_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_operational_event_product" AS child
     WHERE child."product_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_product" AS parent
          WHERE parent."product_id" = child."product_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_operational_event_product__product_id__ops_product';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_operational_event_product"
  ADD CONSTRAINT "fk_ops_operational_event_product__product_id__ops_product"
  FOREIGN KEY ("product_id")
  REFERENCES public."ops_product" ("product_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_product" AS child
     WHERE child."base_unit_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_unit" AS parent
          WHERE parent."unit_id" = child."base_unit_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_product__base_unit_id__app_unit';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_product"
  ADD CONSTRAINT "fk_ops_product__base_unit_id__app_unit"
  FOREIGN KEY ("base_unit_id")
  REFERENCES public."app_unit" ("unit_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_product" AS child
     WHERE child."created_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."created_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_product__created_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_product"
  ADD CONSTRAINT "fk_ops_product__created_by_user_id__app_user"
  FOREIGN KEY ("created_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_product_alias" AS child
     WHERE child."created_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."created_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_product_alias__created_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_product_alias"
  ADD CONSTRAINT "fk_ops_product_alias__created_by_user_id__app_user"
  FOREIGN KEY ("created_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_product_alias" AS child
     WHERE child."product_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_product" AS parent
          WHERE parent."product_id" = child."product_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_product_alias__product_id__ops_product';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_product_alias"
  ADD CONSTRAINT "fk_ops_product_alias__product_id__ops_product"
  FOREIGN KEY ("product_id")
  REFERENCES public."ops_product" ("product_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_product_alias" AS child
     WHERE child."source_system_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_source_system" AS parent
          WHERE parent."source_system_id" = child."source_system_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_product_alias__source_system_id__app_source_system';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_product_alias"
  ADD CONSTRAINT "fk_ops_product_alias__source_system_id__app_source_system"
  FOREIGN KEY ("source_system_id")
  REFERENCES public."app_source_system" ("source_system_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_production_plan_line" AS child
     WHERE child."based_on_plan_line_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_production_plan_line" AS parent
          WHERE parent."production_plan_line_id" = child."based_on_plan_line_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_production_plan_line__based_on_plan_line_id___b54d3d1182';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_production_plan_line"
  ADD CONSTRAINT "fk_ops_production_plan_line__based_on_plan_line_id___b54d3d1182"
  FOREIGN KEY ("based_on_plan_line_id")
  REFERENCES public."ops_production_plan_line" ("production_plan_line_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_production_plan_line" AS child
     WHERE child."confirmed_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."confirmed_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_production_plan_line__confirmed_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_production_plan_line"
  ADD CONSTRAINT "fk_ops_production_plan_line__confirmed_by_user_id__app_user"
  FOREIGN KEY ("confirmed_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_production_plan_line" AS child
     WHERE child."forecast_line_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_forecast_line" AS parent
          WHERE parent."forecast_line_id" = child."forecast_line_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_production_plan_line__forecast_line_id__ops_f_54ae86263d';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_production_plan_line"
  ADD CONSTRAINT "fk_ops_production_plan_line__forecast_line_id__ops_f_54ae86263d"
  FOREIGN KEY ("forecast_line_id")
  REFERENCES public."ops_forecast_line" ("forecast_line_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_production_plan_line" AS child
     WHERE child."product_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_product" AS parent
          WHERE parent."product_id" = child."product_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_production_plan_line__product_id__ops_product';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_production_plan_line"
  ADD CONSTRAINT "fk_ops_production_plan_line__product_id__ops_product"
  FOREIGN KEY ("product_id")
  REFERENCES public."ops_product" ("product_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_production_plan_line" AS child
     WHERE child."production_plan_version_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_production_plan_version" AS parent
          WHERE parent."production_plan_version_id" = child."production_plan_version_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_production_plan_line__production_plan_version_5830928f23';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_production_plan_line"
  ADD CONSTRAINT "fk_ops_production_plan_line__production_plan_version_5830928f23"
  FOREIGN KEY ("production_plan_version_id")
  REFERENCES public."ops_production_plan_version" ("production_plan_version_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_production_plan_line" AS child
     WHERE child."suggested_by_ai_call_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ai_call" AS parent
          WHERE parent."ai_call_id" = child."suggested_by_ai_call_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_production_plan_line__suggested_by_ai_call_id__ai_call';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_production_plan_line"
  ADD CONSTRAINT "fk_ops_production_plan_line__suggested_by_ai_call_id__ai_call"
  FOREIGN KEY ("suggested_by_ai_call_id")
  REFERENCES public."ai_call" ("ai_call_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_production_plan_line" AS child
     WHERE child."unit_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_unit" AS parent
          WHERE parent."unit_id" = child."unit_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_production_plan_line__unit_id__app_unit';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_production_plan_line"
  ADD CONSTRAINT "fk_ops_production_plan_line__unit_id__app_unit"
  FOREIGN KEY ("unit_id")
  REFERENCES public."app_unit" ("unit_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_production_plan_version" AS child
     WHERE child."approved_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."approved_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_production_plan_version__approved_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_production_plan_version"
  ADD CONSTRAINT "fk_ops_production_plan_version__approved_by_user_id__app_user"
  FOREIGN KEY ("approved_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_production_plan_version" AS child
     WHERE child."based_on_version_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_production_plan_version" AS parent
          WHERE parent."production_plan_version_id" = child."based_on_version_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_production_plan_version__based_on_version_id__9c3837d86d';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_production_plan_version"
  ADD CONSTRAINT "fk_ops_production_plan_version__based_on_version_id__9c3837d86d"
  FOREIGN KEY ("based_on_version_id")
  REFERENCES public."ops_production_plan_version" ("production_plan_version_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_production_plan_version" AS child
     WHERE child."created_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."created_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_production_plan_version__created_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_production_plan_version"
  ADD CONSTRAINT "fk_ops_production_plan_version__created_by_user_id__app_user"
  FOREIGN KEY ("created_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_production_plan_version" AS child
     WHERE child."forecast_run_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_forecast_run" AS parent
          WHERE parent."forecast_run_id" = child."forecast_run_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_production_plan_version__forecast_run_id__ops_bee2bebc82';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_production_plan_version"
  ADD CONSTRAINT "fk_ops_production_plan_version__forecast_run_id__ops_bee2bebc82"
  FOREIGN KEY ("forecast_run_id")
  REFERENCES public."ops_forecast_run" ("forecast_run_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_production_plan_version" AS child
     WHERE child."location_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_location" AS parent
          WHERE parent."location_id" = child."location_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_production_plan_version__location_id__ops_location';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_production_plan_version"
  ADD CONSTRAINT "fk_ops_production_plan_version__location_id__ops_location"
  FOREIGN KEY ("location_id")
  REFERENCES public."ops_location" ("location_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_review_action" AS child
     WHERE child."created_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."created_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_review_action__created_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_review_action"
  ADD CONSTRAINT "fk_ops_review_action__created_by_user_id__app_user"
  FOREIGN KEY ("created_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_review_action" AS child
     WHERE child."daily_review_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_daily_review" AS parent
          WHERE parent."daily_review_id" = child."daily_review_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_review_action__daily_review_id__ops_daily_review';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_review_action"
  ADD CONSTRAINT "fk_ops_review_action__daily_review_id__ops_daily_review"
  FOREIGN KEY ("daily_review_id")
  REFERENCES public."ops_daily_review" ("daily_review_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_review_action" AS child
     WHERE child."owner_employment_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."hr_employment" AS parent
          WHERE parent."employment_id" = child."owner_employment_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_review_action__owner_employment_id__hr_employment';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_review_action"
  ADD CONSTRAINT "fk_ops_review_action__owner_employment_id__hr_employment"
  FOREIGN KEY ("owner_employment_id")
  REFERENCES public."hr_employment" ("employment_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_role" AS child
     WHERE child."created_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."created_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_role__created_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_role"
  ADD CONSTRAINT "fk_ops_role__created_by_user_id__app_user"
  FOREIGN KEY ("created_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_stockout_event" AS child
     WHERE child."created_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."created_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_stockout_event__created_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_stockout_event"
  ADD CONSTRAINT "fk_ops_stockout_event__created_by_user_id__app_user"
  FOREIGN KEY ("created_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_stockout_event" AS child
     WHERE child."detected_job_run_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_job_run" AS parent
          WHERE parent."job_run_id" = child."detected_job_run_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_stockout_event__detected_job_run_id__app_job_run';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_stockout_event"
  ADD CONSTRAINT "fk_ops_stockout_event__detected_job_run_id__app_job_run"
  FOREIGN KEY ("detected_job_run_id")
  REFERENCES public."app_job_run" ("job_run_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_stockout_event" AS child
     WHERE child."listing_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."pos_product_listing" AS parent
          WHERE parent."listing_id" = child."listing_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_stockout_event__listing_id__pos_product_listing';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_stockout_event"
  ADD CONSTRAINT "fk_ops_stockout_event__listing_id__pos_product_listing"
  FOREIGN KEY ("listing_id")
  REFERENCES public."pos_product_listing" ("listing_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."ops_stockout_event" AS child
     WHERE child."location_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_location" AS parent
          WHERE parent."location_id" = child."location_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_ops_stockout_event__location_id__ops_location';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."ops_stockout_event"
  ADD CONSTRAINT "fk_ops_stockout_event__location_id__ops_location"
  FOREIGN KEY ("location_id")
  REFERENCES public."ops_location" ("location_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_daily_breakdown" AS child
     WHERE child."location_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_location" AS parent
          WHERE parent."location_id" = child."location_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_daily_breakdown__location_id__ops_location';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_daily_breakdown"
  ADD CONSTRAINT "fk_pos_daily_breakdown__location_id__ops_location"
  FOREIGN KEY ("location_id")
  REFERENCES public."ops_location" ("location_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_daily_breakdown" AS child
     WHERE child."pos_ingest_batch_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."pos_ingest_batch" AS parent
          WHERE parent."pos_ingest_batch_id" = child."pos_ingest_batch_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_daily_breakdown__pos_ingest_batch_id__pos_ingest_batch';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_daily_breakdown"
  ADD CONSTRAINT "fk_pos_daily_breakdown__pos_ingest_batch_id__pos_ingest_batch"
  FOREIGN KEY ("pos_ingest_batch_id")
  REFERENCES public."pos_ingest_batch" ("pos_ingest_batch_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_ingest_batch" AS child
     WHERE child."job_run_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_job_run" AS parent
          WHERE parent."job_run_id" = child."job_run_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_ingest_batch__job_run_id__app_job_run';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_ingest_batch"
  ADD CONSTRAINT "fk_pos_ingest_batch__job_run_id__app_job_run"
  FOREIGN KEY ("job_run_id")
  REFERENCES public."app_job_run" ("job_run_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_ingest_batch" AS child
     WHERE child."location_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_location" AS parent
          WHERE parent."location_id" = child."location_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_ingest_batch__location_id__ops_location';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_ingest_batch"
  ADD CONSTRAINT "fk_pos_ingest_batch__location_id__ops_location"
  FOREIGN KEY ("location_id")
  REFERENCES public."ops_location" ("location_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_ingest_batch" AS child
     WHERE child."source_system_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_source_system" AS parent
          WHERE parent."source_system_id" = child."source_system_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_ingest_batch__source_system_id__app_source_system';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_ingest_batch"
  ADD CONSTRAINT "fk_pos_ingest_batch__source_system_id__app_source_system"
  FOREIGN KEY ("source_system_id")
  REFERENCES public."app_source_system" ("source_system_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_ingest_batch" AS child
     WHERE child."supersedes_pos_ingest_batch_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."pos_ingest_batch" AS parent
          WHERE parent."pos_ingest_batch_id" = child."supersedes_pos_ingest_batch_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_ingest_batch__supersedes_pos_ingest_batch_id__8daf307281';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_ingest_batch"
  ADD CONSTRAINT "fk_pos_ingest_batch__supersedes_pos_ingest_batch_id__8daf307281"
  FOREIGN KEY ("supersedes_pos_ingest_batch_id")
  REFERENCES public."pos_ingest_batch" ("pos_ingest_batch_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_item_sales_hour" AS child
     WHERE child."listing_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."pos_product_listing" AS parent
          WHERE parent."listing_id" = child."listing_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_item_sales_hour__listing_id__pos_product_listing';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_item_sales_hour"
  ADD CONSTRAINT "fk_pos_item_sales_hour__listing_id__pos_product_listing"
  FOREIGN KEY ("listing_id")
  REFERENCES public."pos_product_listing" ("listing_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_item_sales_hour" AS child
     WHERE child."location_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_location" AS parent
          WHERE parent."location_id" = child."location_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_item_sales_hour__location_id__ops_location';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_item_sales_hour"
  ADD CONSTRAINT "fk_pos_item_sales_hour__location_id__ops_location"
  FOREIGN KEY ("location_id")
  REFERENCES public."ops_location" ("location_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_item_sales_hour" AS child
     WHERE child."pos_ingest_batch_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."pos_ingest_batch" AS parent
          WHERE parent."pos_ingest_batch_id" = child."pos_ingest_batch_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_item_sales_hour__pos_ingest_batch_id__pos_ingest_batch';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_item_sales_hour"
  ADD CONSTRAINT "fk_pos_item_sales_hour__pos_ingest_batch_id__pos_ingest_batch"
  FOREIGN KEY ("pos_ingest_batch_id")
  REFERENCES public."pos_ingest_batch" ("pos_ingest_batch_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_item_waste" AS child
     WHERE child."listing_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."pos_product_listing" AS parent
          WHERE parent."listing_id" = child."listing_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_item_waste__listing_id__pos_product_listing';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_item_waste"
  ADD CONSTRAINT "fk_pos_item_waste__listing_id__pos_product_listing"
  FOREIGN KEY ("listing_id")
  REFERENCES public."pos_product_listing" ("listing_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_item_waste" AS child
     WHERE child."location_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_location" AS parent
          WHERE parent."location_id" = child."location_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_item_waste__location_id__ops_location';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_item_waste"
  ADD CONSTRAINT "fk_pos_item_waste__location_id__ops_location"
  FOREIGN KEY ("location_id")
  REFERENCES public."ops_location" ("location_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_item_waste" AS child
     WHERE child."pos_ingest_batch_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."pos_ingest_batch" AS parent
          WHERE parent."pos_ingest_batch_id" = child."pos_ingest_batch_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_item_waste__pos_ingest_batch_id__pos_ingest_batch';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_item_waste"
  ADD CONSTRAINT "fk_pos_item_waste__pos_ingest_batch_id__pos_ingest_batch"
  FOREIGN KEY ("pos_ingest_batch_id")
  REFERENCES public."pos_ingest_batch" ("pos_ingest_batch_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_member" AS child
     WHERE child."home_location_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_location" AS parent
          WHERE parent."location_id" = child."home_location_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_member__home_location_id__ops_location';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_member"
  ADD CONSTRAINT "fk_pos_member__home_location_id__ops_location"
  FOREIGN KEY ("home_location_id")
  REFERENCES public."ops_location" ("location_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_member" AS child
     WHERE child."merged_into_member_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."pos_member" AS parent
          WHERE parent."member_id" = child."merged_into_member_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_member__merged_into_member_id__pos_member';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_member"
  ADD CONSTRAINT "fk_pos_member__merged_into_member_id__pos_member"
  FOREIGN KEY ("merged_into_member_id")
  REFERENCES public."pos_member" ("member_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_member" AS child
     WHERE child."source_system_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_source_system" AS parent
          WHERE parent."source_system_id" = child."source_system_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_member__source_system_id__app_source_system';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_member"
  ADD CONSTRAINT "fk_pos_member__source_system_id__app_source_system"
  FOREIGN KEY ("source_system_id")
  REFERENCES public."app_source_system" ("source_system_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_member_balance_snapshot" AS child
     WHERE child."member_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."pos_member" AS parent
          WHERE parent."member_id" = child."member_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_member_balance_snapshot__member_id__pos_member';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_member_balance_snapshot"
  ADD CONSTRAINT "fk_pos_member_balance_snapshot__member_id__pos_member"
  FOREIGN KEY ("member_id")
  REFERENCES public."pos_member" ("member_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_member_balance_snapshot" AS child
     WHERE child."pos_ingest_batch_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."pos_ingest_batch" AS parent
          WHERE parent."pos_ingest_batch_id" = child."pos_ingest_batch_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_member_balance_snapshot__pos_ingest_batch_id__0e17011c8c';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_member_balance_snapshot"
  ADD CONSTRAINT "fk_pos_member_balance_snapshot__pos_ingest_batch_id__0e17011c8c"
  FOREIGN KEY ("pos_ingest_batch_id")
  REFERENCES public."pos_ingest_batch" ("pos_ingest_batch_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_member_card" AS child
     WHERE child."issued_location_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_location" AS parent
          WHERE parent."location_id" = child."issued_location_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_member_card__issued_location_id__ops_location';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_member_card"
  ADD CONSTRAINT "fk_pos_member_card__issued_location_id__ops_location"
  FOREIGN KEY ("issued_location_id")
  REFERENCES public."ops_location" ("location_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_member_card" AS child
     WHERE child."member_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."pos_member" AS parent
          WHERE parent."member_id" = child."member_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_member_card__member_id__pos_member';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_member_card"
  ADD CONSTRAINT "fk_pos_member_card__member_id__pos_member"
  FOREIGN KEY ("member_id")
  REFERENCES public."pos_member" ("member_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_member_card" AS child
     WHERE child."source_system_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_source_system" AS parent
          WHERE parent."source_system_id" = child."source_system_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_member_card__source_system_id__app_source_system';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_member_card"
  ADD CONSTRAINT "fk_pos_member_card__source_system_id__app_source_system"
  FOREIGN KEY ("source_system_id")
  REFERENCES public."app_source_system" ("source_system_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_member_card_transaction" AS child
     WHERE child."location_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_location" AS parent
          WHERE parent."location_id" = child."location_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_member_card_transaction__location_id__ops_location';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_member_card_transaction"
  ADD CONSTRAINT "fk_pos_member_card_transaction__location_id__ops_location"
  FOREIGN KEY ("location_id")
  REFERENCES public."ops_location" ("location_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_member_card_transaction" AS child
     WHERE child."member_card_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."pos_member_card" AS parent
          WHERE parent."member_card_id" = child."member_card_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_member_card_transaction__member_card_id__pos_member_card';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_member_card_transaction"
  ADD CONSTRAINT "fk_pos_member_card_transaction__member_card_id__pos_member_card"
  FOREIGN KEY ("member_card_id")
  REFERENCES public."pos_member_card" ("member_card_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_member_card_transaction" AS child
     WHERE child."member_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."pos_member" AS parent
          WHERE parent."member_id" = child."member_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_member_card_transaction__member_id__pos_member';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_member_card_transaction"
  ADD CONSTRAINT "fk_pos_member_card_transaction__member_id__pos_member"
  FOREIGN KEY ("member_id")
  REFERENCES public."pos_member" ("member_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_member_card_transaction" AS child
     WHERE child."order_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."pos_order" AS parent
          WHERE parent."order_id" = child."order_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_member_card_transaction__order_id__pos_order';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_member_card_transaction"
  ADD CONSTRAINT "fk_pos_member_card_transaction__order_id__pos_order"
  FOREIGN KEY ("order_id")
  REFERENCES public."pos_order" ("order_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_member_card_transaction" AS child
     WHERE child."pos_ingest_batch_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."pos_ingest_batch" AS parent
          WHERE parent."pos_ingest_batch_id" = child."pos_ingest_batch_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_member_card_transaction__pos_ingest_batch_id__ac8f2618b2';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_member_card_transaction"
  ADD CONSTRAINT "fk_pos_member_card_transaction__pos_ingest_batch_id__ac8f2618b2"
  FOREIGN KEY ("pos_ingest_batch_id")
  REFERENCES public."pos_ingest_batch" ("pos_ingest_batch_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_member_card_transaction" AS child
     WHERE child."source_system_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_source_system" AS parent
          WHERE parent."source_system_id" = child."source_system_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_member_card_transaction__source_system_id__ap_ae5590be43';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_member_card_transaction"
  ADD CONSTRAINT "fk_pos_member_card_transaction__source_system_id__ap_ae5590be43"
  FOREIGN KEY ("source_system_id")
  REFERENCES public."app_source_system" ("source_system_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_member_contact" AS child
     WHERE child."member_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."pos_member" AS parent
          WHERE parent."member_id" = child."member_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_member_contact__member_id__pos_member';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_member_contact"
  ADD CONSTRAINT "fk_pos_member_contact__member_id__pos_member"
  FOREIGN KEY ("member_id")
  REFERENCES public."pos_member" ("member_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_member_daily_metric" AS child
     WHERE child."location_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_location" AS parent
          WHERE parent."location_id" = child."location_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_member_daily_metric__location_id__ops_location';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_member_daily_metric"
  ADD CONSTRAINT "fk_pos_member_daily_metric__location_id__ops_location"
  FOREIGN KEY ("location_id")
  REFERENCES public."ops_location" ("location_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_member_daily_metric" AS child
     WHERE child."pos_ingest_batch_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."pos_ingest_batch" AS parent
          WHERE parent."pos_ingest_batch_id" = child."pos_ingest_batch_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_member_daily_metric__pos_ingest_batch_id__pos_da561effe7';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_member_daily_metric"
  ADD CONSTRAINT "fk_pos_member_daily_metric__pos_ingest_batch_id__pos_da561effe7"
  FOREIGN KEY ("pos_ingest_batch_id")
  REFERENCES public."pos_ingest_batch" ("pos_ingest_batch_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_order" AS child
     WHERE child."first_seen_pos_ingest_batch_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."pos_ingest_batch" AS parent
          WHERE parent."pos_ingest_batch_id" = child."first_seen_pos_ingest_batch_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_order__first_seen_pos_ingest_batch_id__pos_ingest_batch';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_order"
  ADD CONSTRAINT "fk_pos_order__first_seen_pos_ingest_batch_id__pos_ingest_batch"
  FOREIGN KEY ("first_seen_pos_ingest_batch_id")
  REFERENCES public."pos_ingest_batch" ("pos_ingest_batch_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_order" AS child
     WHERE child."location_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_location" AS parent
          WHERE parent."location_id" = child."location_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_order__location_id__ops_location';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_order"
  ADD CONSTRAINT "fk_pos_order__location_id__ops_location"
  FOREIGN KEY ("location_id")
  REFERENCES public."ops_location" ("location_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_order" AS child
     WHERE child."source_system_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_source_system" AS parent
          WHERE parent."source_system_id" = child."source_system_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_order__source_system_id__app_source_system';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_order"
  ADD CONSTRAINT "fk_pos_order__source_system_id__app_source_system"
  FOREIGN KEY ("source_system_id")
  REFERENCES public."app_source_system" ("source_system_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_order_item" AS child
     WHERE child."listing_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."pos_product_listing" AS parent
          WHERE parent."listing_id" = child."listing_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_order_item__listing_id__pos_product_listing';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_order_item"
  ADD CONSTRAINT "fk_pos_order_item__listing_id__pos_product_listing"
  FOREIGN KEY ("listing_id")
  REFERENCES public."pos_product_listing" ("listing_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_order_item" AS child
     WHERE child."order_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."pos_order" AS parent
          WHERE parent."order_id" = child."order_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_order_item__order_id__pos_order';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_order_item"
  ADD CONSTRAINT "fk_pos_order_item__order_id__pos_order"
  FOREIGN KEY ("order_id")
  REFERENCES public."pos_order" ("order_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_order_item" AS child
     WHERE child."pos_ingest_batch_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."pos_ingest_batch" AS parent
          WHERE parent."pos_ingest_batch_id" = child."pos_ingest_batch_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_order_item__pos_ingest_batch_id__pos_ingest_batch';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_order_item"
  ADD CONSTRAINT "fk_pos_order_item__pos_ingest_batch_id__pos_ingest_batch"
  FOREIGN KEY ("pos_ingest_batch_id")
  REFERENCES public."pos_ingest_batch" ("pos_ingest_batch_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_product_listing" AS child
     WHERE child."location_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_location" AS parent
          WHERE parent."location_id" = child."location_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_product_listing__location_id__ops_location';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_product_listing"
  ADD CONSTRAINT "fk_pos_product_listing__location_id__ops_location"
  FOREIGN KEY ("location_id")
  REFERENCES public."ops_location" ("location_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_product_listing" AS child
     WHERE child."source_system_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_source_system" AS parent
          WHERE parent."source_system_id" = child."source_system_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_product_listing__source_system_id__app_source_system';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_product_listing"
  ADD CONSTRAINT "fk_pos_product_listing__source_system_id__app_source_system"
  FOREIGN KEY ("source_system_id")
  REFERENCES public."app_source_system" ("source_system_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_product_mapping" AS child
     WHERE child."created_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."created_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_product_mapping__created_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_product_mapping"
  ADD CONSTRAINT "fk_pos_product_mapping__created_by_user_id__app_user"
  FOREIGN KEY ("created_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_product_mapping" AS child
     WHERE child."listing_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."pos_product_listing" AS parent
          WHERE parent."listing_id" = child."listing_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_product_mapping__listing_id__pos_product_listing';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_product_mapping"
  ADD CONSTRAINT "fk_pos_product_mapping__listing_id__pos_product_listing"
  FOREIGN KEY ("listing_id")
  REFERENCES public."pos_product_listing" ("listing_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_product_mapping" AS child
     WHERE child."product_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_product" AS parent
          WHERE parent."product_id" = child."product_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_product_mapping__product_id__ops_product';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_product_mapping"
  ADD CONSTRAINT "fk_pos_product_mapping__product_id__ops_product"
  FOREIGN KEY ("product_id")
  REFERENCES public."ops_product" ("product_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_product_mapping_review" AS child
     WHERE child."candidate_product_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_product" AS parent
          WHERE parent."product_id" = child."candidate_product_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_product_mapping_review__candidate_product_id__5dc66d1ac9';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_product_mapping_review"
  ADD CONSTRAINT "fk_pos_product_mapping_review__candidate_product_id__5dc66d1ac9"
  FOREIGN KEY ("candidate_product_id")
  REFERENCES public."ops_product" ("product_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_product_mapping_review" AS child
     WHERE child."created_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."created_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_product_mapping_review__created_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_product_mapping_review"
  ADD CONSTRAINT "fk_pos_product_mapping_review__created_by_user_id__app_user"
  FOREIGN KEY ("created_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_product_mapping_review" AS child
     WHERE child."listing_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."pos_product_listing" AS parent
          WHERE parent."listing_id" = child."listing_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_product_mapping_review__listing_id__pos_product_listing';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_product_mapping_review"
  ADD CONSTRAINT "fk_pos_product_mapping_review__listing_id__pos_product_listing"
  FOREIGN KEY ("listing_id")
  REFERENCES public."pos_product_listing" ("listing_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_product_mapping_review" AS child
     WHERE child."reviewed_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."reviewed_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_product_mapping_review__reviewed_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_product_mapping_review"
  ADD CONSTRAINT "fk_pos_product_mapping_review__reviewed_by_user_id__app_user"
  FOREIGN KEY ("reviewed_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_sales_day" AS child
     WHERE child."location_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_location" AS parent
          WHERE parent."location_id" = child."location_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_sales_day__location_id__ops_location';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_sales_day"
  ADD CONSTRAINT "fk_pos_sales_day__location_id__ops_location"
  FOREIGN KEY ("location_id")
  REFERENCES public."ops_location" ("location_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_sales_day" AS child
     WHERE child."pos_ingest_batch_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."pos_ingest_batch" AS parent
          WHERE parent."pos_ingest_batch_id" = child."pos_ingest_batch_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_sales_day__pos_ingest_batch_id__pos_ingest_batch';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_sales_day"
  ADD CONSTRAINT "fk_pos_sales_day__pos_ingest_batch_id__pos_ingest_batch"
  FOREIGN KEY ("pos_ingest_batch_id")
  REFERENCES public."pos_ingest_batch" ("pos_ingest_batch_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_sales_hour" AS child
     WHERE child."location_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."ops_location" AS parent
          WHERE parent."location_id" = child."location_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_sales_hour__location_id__ops_location';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_sales_hour"
  ADD CONSTRAINT "fk_pos_sales_hour__location_id__ops_location"
  FOREIGN KEY ("location_id")
  REFERENCES public."ops_location" ("location_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."pos_sales_hour" AS child
     WHERE child."pos_ingest_batch_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."pos_ingest_batch" AS parent
          WHERE parent."pos_ingest_batch_id" = child."pos_ingest_batch_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_pos_sales_hour__pos_ingest_batch_id__pos_ingest_batch';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."pos_sales_hour"
  ADD CONSTRAINT "fk_pos_sales_hour__pos_ingest_batch_id__pos_ingest_batch"
  FOREIGN KEY ("pos_ingest_batch_id")
  REFERENCES public."pos_ingest_batch" ("pos_ingest_batch_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."scm_material" AS child
     WHERE child."base_unit_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_unit" AS parent
          WHERE parent."unit_id" = child."base_unit_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_scm_material__base_unit_id__app_unit';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."scm_material"
  ADD CONSTRAINT "fk_scm_material__base_unit_id__app_unit"
  FOREIGN KEY ("base_unit_id")
  REFERENCES public."app_unit" ("unit_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."scm_material" AS child
     WHERE child."created_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."created_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_scm_material__created_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."scm_material"
  ADD CONSTRAINT "fk_scm_material__created_by_user_id__app_user"
  FOREIGN KEY ("created_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."scm_material_alias" AS child
     WHERE child."created_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."created_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_scm_material_alias__created_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."scm_material_alias"
  ADD CONSTRAINT "fk_scm_material_alias__created_by_user_id__app_user"
  FOREIGN KEY ("created_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."scm_material_alias" AS child
     WHERE child."material_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."scm_material" AS parent
          WHERE parent."material_id" = child."material_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_scm_material_alias__material_id__scm_material';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."scm_material_alias"
  ADD CONSTRAINT "fk_scm_material_alias__material_id__scm_material"
  FOREIGN KEY ("material_id")
  REFERENCES public."scm_material" ("material_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."scm_material_alias" AS child
     WHERE child."source_system_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_source_system" AS parent
          WHERE parent."source_system_id" = child."source_system_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_scm_material_alias__source_system_id__app_source_system';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."scm_material_alias"
  ADD CONSTRAINT "fk_scm_material_alias__source_system_id__app_source_system"
  FOREIGN KEY ("source_system_id")
  REFERENCES public."app_source_system" ("source_system_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."scm_material_source_identity" AS child
     WHERE child."created_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."created_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_scm_material_source_identity__created_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."scm_material_source_identity"
  ADD CONSTRAINT "fk_scm_material_source_identity__created_by_user_id__app_user"
  FOREIGN KEY ("created_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."scm_material_source_identity" AS child
     WHERE child."material_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."scm_material" AS parent
          WHERE parent."material_id" = child."material_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_scm_material_source_identity__material_id__scm_material';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."scm_material_source_identity"
  ADD CONSTRAINT "fk_scm_material_source_identity__material_id__scm_material"
  FOREIGN KEY ("material_id")
  REFERENCES public."scm_material" ("material_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."scm_material_source_identity" AS child
     WHERE child."source_system_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_source_system" AS parent
          WHERE parent."source_system_id" = child."source_system_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_scm_material_source_identity__source_system_id__a_014e30705b';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."scm_material_source_identity"
  ADD CONSTRAINT "fk_scm_material_source_identity__source_system_id__a_014e30705b"
  FOREIGN KEY ("source_system_id")
  REFERENCES public."app_source_system" ("source_system_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."scm_material_unit_conversion" AS child
     WHERE child."created_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."created_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_scm_material_unit_conversion__created_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."scm_material_unit_conversion"
  ADD CONSTRAINT "fk_scm_material_unit_conversion__created_by_user_id__app_user"
  FOREIGN KEY ("created_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."scm_material_unit_conversion" AS child
     WHERE child."from_unit_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_unit" AS parent
          WHERE parent."unit_id" = child."from_unit_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_scm_material_unit_conversion__from_unit_id__app_unit';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."scm_material_unit_conversion"
  ADD CONSTRAINT "fk_scm_material_unit_conversion__from_unit_id__app_unit"
  FOREIGN KEY ("from_unit_id")
  REFERENCES public."app_unit" ("unit_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."scm_material_unit_conversion" AS child
     WHERE child."material_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."scm_material" AS parent
          WHERE parent."material_id" = child."material_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_scm_material_unit_conversion__material_id__scm_material';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."scm_material_unit_conversion"
  ADD CONSTRAINT "fk_scm_material_unit_conversion__material_id__scm_material"
  FOREIGN KEY ("material_id")
  REFERENCES public."scm_material" ("material_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."scm_material_unit_conversion" AS child
     WHERE child."source_system_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_source_system" AS parent
          WHERE parent."source_system_id" = child."source_system_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_scm_material_unit_conversion__source_system_id__a_5816ce7198';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."scm_material_unit_conversion"
  ADD CONSTRAINT "fk_scm_material_unit_conversion__source_system_id__a_5816ce7198"
  FOREIGN KEY ("source_system_id")
  REFERENCES public."app_source_system" ("source_system_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."scm_material_unit_conversion" AS child
     WHERE child."to_unit_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_unit" AS parent
          WHERE parent."unit_id" = child."to_unit_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_scm_material_unit_conversion__to_unit_id__app_unit';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."scm_material_unit_conversion"
  ADD CONSTRAINT "fk_scm_material_unit_conversion__to_unit_id__app_unit"
  FOREIGN KEY ("to_unit_id")
  REFERENCES public."app_unit" ("unit_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."scm_material_unit_conversion" AS child
     WHERE child."verified_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."verified_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_scm_material_unit_conversion__verified_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."scm_material_unit_conversion"
  ADD CONSTRAINT "fk_scm_material_unit_conversion__verified_by_user_id__app_user"
  FOREIGN KEY ("verified_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."scm_supplier" AS child
     WHERE child."created_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."created_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_scm_supplier__created_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."scm_supplier"
  ADD CONSTRAINT "fk_scm_supplier__created_by_user_id__app_user"
  FOREIGN KEY ("created_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."scm_supplier_item" AS child
     WHERE child."confirmed_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."confirmed_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_scm_supplier_item__confirmed_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."scm_supplier_item"
  ADD CONSTRAINT "fk_scm_supplier_item__confirmed_by_user_id__app_user"
  FOREIGN KEY ("confirmed_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."scm_supplier_item" AS child
     WHERE child."created_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."created_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_scm_supplier_item__created_by_user_id__app_user';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."scm_supplier_item"
  ADD CONSTRAINT "fk_scm_supplier_item__created_by_user_id__app_user"
  FOREIGN KEY ("created_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."scm_supplier_item" AS child
     WHERE child."material_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."scm_material" AS parent
          WHERE parent."material_id" = child."material_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_scm_supplier_item__material_id__scm_material';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."scm_supplier_item"
  ADD CONSTRAINT "fk_scm_supplier_item__material_id__scm_material"
  FOREIGN KEY ("material_id")
  REFERENCES public."scm_material" ("material_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."scm_supplier_item" AS child
     WHERE child."material_unit_conversion_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."scm_material_unit_conversion" AS parent
          WHERE parent."material_unit_conversion_id" = child."material_unit_conversion_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_scm_supplier_item__material_unit_conversion_id__s_251d061d88';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."scm_supplier_item"
  ADD CONSTRAINT "fk_scm_supplier_item__material_unit_conversion_id__s_251d061d88"
  FOREIGN KEY ("material_unit_conversion_id")
  REFERENCES public."scm_material_unit_conversion" ("material_unit_conversion_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."scm_supplier_item" AS child
     WHERE child."order_unit_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_unit" AS parent
          WHERE parent."unit_id" = child."order_unit_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_scm_supplier_item__order_unit_id__app_unit';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."scm_supplier_item"
  ADD CONSTRAINT "fk_scm_supplier_item__order_unit_id__app_unit"
  FOREIGN KEY ("order_unit_id")
  REFERENCES public."app_unit" ("unit_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."scm_supplier_item" AS child
     WHERE child."supersedes_supplier_item_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."scm_supplier_item" AS parent
          WHERE parent."supplier_item_id" = child."supersedes_supplier_item_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_scm_supplier_item__supersedes_supplier_item_id__s_6a7ddaf4fd';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."scm_supplier_item"
  ADD CONSTRAINT "fk_scm_supplier_item__supersedes_supplier_item_id__s_6a7ddaf4fd"
  FOREIGN KEY ("supersedes_supplier_item_id")
  REFERENCES public."scm_supplier_item" ("supplier_item_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."scm_supplier_item" AS child
     WHERE child."supplier_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."scm_supplier" AS parent
          WHERE parent."supplier_id" = child."supplier_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_scm_supplier_item__supplier_id__scm_supplier';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."scm_supplier_item"
  ADD CONSTRAINT "fk_scm_supplier_item__supplier_id__scm_supplier"
  FOREIGN KEY ("supplier_id")
  REFERENCES public."scm_supplier" ("supplier_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."scm_supplier_price_observation" AS child
     WHERE child."material_unit_conversion_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."scm_material_unit_conversion" AS parent
          WHERE parent."material_unit_conversion_id" = child."material_unit_conversion_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_scm_supplier_price_observation__material_unit_con_43103b9e4a';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."scm_supplier_price_observation"
  ADD CONSTRAINT "fk_scm_supplier_price_observation__material_unit_con_43103b9e4a"
  FOREIGN KEY ("material_unit_conversion_id")
  REFERENCES public."scm_material_unit_conversion" ("material_unit_conversion_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."scm_supplier_price_observation" AS child
     WHERE child."raw_price_unit_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_unit" AS parent
          WHERE parent."unit_id" = child."raw_price_unit_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_scm_supplier_price_observation__raw_price_unit_id__app_unit';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."scm_supplier_price_observation"
  ADD CONSTRAINT "fk_scm_supplier_price_observation__raw_price_unit_id__app_unit"
  FOREIGN KEY ("raw_price_unit_id")
  REFERENCES public."app_unit" ("unit_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."scm_supplier_price_observation" AS child
     WHERE child."source_system_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_source_system" AS parent
          WHERE parent."source_system_id" = child."source_system_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_scm_supplier_price_observation__source_system_id__26fba08c01';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."scm_supplier_price_observation"
  ADD CONSTRAINT "fk_scm_supplier_price_observation__source_system_id__26fba08c01"
  FOREIGN KEY ("source_system_id")
  REFERENCES public."app_source_system" ("source_system_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."scm_supplier_price_observation" AS child
     WHERE child."supplier_item_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."scm_supplier_item" AS parent
          WHERE parent."supplier_item_id" = child."supplier_item_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_scm_supplier_price_observation__supplier_item_id__a5ba298239';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."scm_supplier_price_observation"
  ADD CONSTRAINT "fk_scm_supplier_price_observation__supplier_item_id__a5ba298239"
  FOREIGN KEY ("supplier_item_id")
  REFERENCES public."scm_supplier_item" ("supplier_item_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
DO $hotcrush_orphan$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."scm_supplier_price_observation" AS child
     WHERE child."verified_by_user_id" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."app_user" AS parent
          WHERE parent."user_id" = child."verified_by_user_id"
       )
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'orphan rows before FK fk_scm_supplier_price_observation__verified_by_user__409dce63fb';
  END IF;
END
$hotcrush_orphan$;
ALTER TABLE public."scm_supplier_price_observation"
  ADD CONSTRAINT "fk_scm_supplier_price_observation__verified_by_user__409dce63fb"
  FOREIGN KEY ("verified_by_user_id")
  REFERENCES public."app_user" ("user_id") MATCH SIMPLE
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;
