"""Fail-closed contract tests for the P0b review-model correction.

These tests validate declarative design metadata only.  They never compile or
execute SQL and never connect to a database.
"""

from __future__ import annotations

from collections import Counter
import inspect
import unittest

from .controlled_vocabularies import (
    POS_PRODUCT_LISTING_ORDINARY_TEXT_FIELDS,
    vocabulary_kind,
)
from .minimal_foundation import CORE_BUSINESS_TABLES, CORE_PLATFORM_TABLES
from .model_types import TableForeignKey, V as DECLARE_VIEW
from .current_to_target import (
    COST_ITEM_SOURCE_AUDIT,
    COST_RECIPE_OUTPUT_AUDIT,
    HBTI_RESULT_ONLY_ANCHOR_CONTRACT,
    REWARD_SOURCE_AUDIT,
    REWARD_TEMPLATE_ALLOWLIST,
    REWARD_TEMPLATE_ALLOWLIST_EXPECTED_SHA256,
    REWARD_TEMPLATE_ALLOWLIST_SHA256,
    validate_source_fidelity_contracts,
)
from .target_model import PHASE1_VIEWS, TABLES, TABLE_BY_NAME, VIEWS, VIEW_BY_NAME


EXPECTED_GRAIN_KEYS = {
    "v_identity_mapping_gap": None,
    "v_product_identity": ("listing_id",),
    "v_pos_sales_day_current": ("location_id", "business_date"),
    "v_pos_sales_hour_current": ("location_id", "business_date", "hour_started_at"),
    "v_pos_item_sales_hour_current": ("location_id", "business_date", "hour_started_at", "listing_id"),
    "v_pos_daily_breakdown_current": ("location_id", "business_date", "dimension_type", "dimension_value"),
    "v_pos_item_sales_day": ("location_id", "business_date", "listing_id"),
    "v_pos_revenue_reconciliation": ("location_id", "business_date"),
    "v_pos_member_state_current": ("member_id",),
    "v_pos_member_daily_metric_current": ("location_id", "business_date"),
    "v_pos_member_daily_summary": ("location_id", "business_date"),
    "v_pos_order_item_current": ("location_id", "business_date", "order_id", "listing_id"),
    "v_pos_order_member_attribution": ("order_id",),
    "v_pos_member_order_item": ("location_id", "business_date", "order_id", "listing_id"),
    "v_ops_forecast_accuracy": ("forecast_run_id", "product_id"),
    "v_ops_item_daily_pulse": ("location_id", "business_date", "product_id"),
    "v_ops_plan_vs_production": ("location_id", "business_date", "product_id"),
    "v_ops_production_vs_dispatch": ("from_location_id", "to_location_id", "business_date", "product_id"),
    "v_ops_product_mix_daily": ("location_id", "business_date", "product_id"),
    "v_hr_application_current_stage": ("application_id",),
    "v_hr_assessment_summary": ("assessment_id",),
    "v_hr_role_eligibility": ("employment_id", "role_id"),
    "v_ops_shift_publish_readiness": ("shift_plan_version_id",),
    "v_hr_timesheet_entry_current": ("source_system_id", "source_entry_id"),
    "v_ops_labor_productivity": ("location_id", "business_date"),
    "v_scm_material_requirement_line": ("material_requirement_key",),
    "v_scm_material_requirement_trace": ("material_requirement_component_id",),
    "v_scm_material_requirement_reconciliation": ("material_requirement_key", "replenishment_line_id"),
    "v_scm_replenishment_trace": ("replenishment_line_id",),
    "v_scm_inventory_balance": ("location_id", "material_id", "lot_code", "expiry_date"),
    "v_scm_purchase_order_reconciliation": ("purchase_order_revision_id",),
    "v_scm_supplier_item_current_mapping": ("supplier_id", "supplier_sku"),
    "v_scm_supplier_price_current": ("supplier_item_id",),
    "v_cost_card_recipe_current": ("output_product_id", "output_material_id"),
    "v_cost_card_product_cost_component": ("location_id", "business_date", "product_id", "recipe_version_id", "path_component_ids", "material_id"),
    "v_cost_card_product_cost_snapshot": ("location_id", "business_date", "product_id"),
    "v_cost_card_product_cost_quality": ("location_id", "business_date", "product_id"),
    "v_cost_card_product_daily_margin": ("location_id", "business_date", "product_id"),
    "v_finance_sales_reconciliation": ("location_id", "business_date"),
    "v_finance_purchase_reconciliation": ("location_id", "business_month", "supplier_id", "material_id"),
    "v_finance_labor_reconciliation": ("location_id", "business_month"),
    "v_finance_margin_reconciliation": ("location_id", "business_month"),
    "v_mkt_campaign_performance": ("campaign_version_id", "location_id"),
    "v_mkt_reward_stock_reconciliation": ("campaign_version_id", "location_id", "reward_id"),
    "v_msg_delivery_current": ("outbound_message_id",),
    "v_app_data_quality_summary": ("source_view_name", "domain_code", "rule_code", "severity", "quality_status"),
    "v_business_timeline": ("event_domain", "event_type", "event_id"),
    "v_ops_timeslot_sales_baseline": ("location_id", "product_id", "day_type", "slot_start", "slot_end"),
    "v_cost_card_daily_margin": ("location_id", "business_date"),
    "v_ops_holiday_factor": ("calendar_event_id", "location_id", "product_id", "category_code"),
    "v_pos_item_waste_current": ("waste_id",),
    "v_pos_item_waste_mapped": ("waste_id",),
    "v_ops_manager_sales_reconciliation": ("daily_review_id",),
    "v_ops_shift_by_role": ("location_id", "business_date", "role_id"),
    "v_cost_card_material_price_current": ("location_id", "material_id"),
    "v_cost_card_recipe_expanded": ("root_recipe_version_id", "path_component_ids", "material_id"),
    "v_ops_daily_review_current": ("location_id", "business_date"),
    "v_finance_import_batch_current": ("source_system_id", "dataset_code", "scope_location_id", "period_start", "period_end", "source_layer"),
    "v_finance_target_current": ("location_id", "business_month", "metric_code"),
}

PASS_VIEWS = {
    "v_mkt_reward_stock_reconciliation", "v_pos_daily_breakdown_current",
    "v_pos_item_sales_day", "v_pos_item_sales_hour_current",
    "v_pos_item_waste_current", "v_pos_item_waste_mapped",
    "v_pos_member_daily_metric_current", "v_pos_order_member_attribution",
    "v_pos_sales_day_current", "v_pos_sales_hour_current",
}

FIX_VIEWS = {
    "v_cost_card_material_price_current", "v_cost_card_product_cost_quality",
    "v_cost_card_recipe_current", "v_finance_import_batch_current",
    "v_finance_target_current", "v_hr_assessment_summary",
    "v_ops_daily_review_current", "v_product_identity",
    "v_scm_supplier_item_current_mapping",
}


class P0bContractTest(unittest.TestCase):
    def test_view_factory_requires_readiness_and_grain_without_defaults(self):
        signature = inspect.signature(DECLARE_VIEW)
        for name in ("readiness_status", "readiness_blockers", "grain_key"):
            self.assertIn(name, signature.parameters)
            self.assertIs(signature.parameters[name].default, inspect.Parameter.empty)

    def test_p0b_golden_counts(self):
        phase1_names = CORE_BUSINESS_TABLES | CORE_PLATFORM_TABLES
        phase1_tables = [table for table in TABLES if table.name in phase1_names]
        self.assertEqual(len(TABLES), 137)
        self.assertEqual(len(VIEWS), 59)
        self.assertEqual(sum(len(t.fields) for t in TABLES), 1812)
        self.assertEqual(sum(len(v.fields) for v in VIEWS), 643)
        self.assertEqual(sum(len(t.fields) for t in phase1_tables), 1374)
        self.assertEqual(sum(len(v.fields) for v in VIEWS if v.name in PHASE1_VIEWS), 471)
        self.assertEqual(sum(len(t.checks) for t in TABLES), 115)
        self.assertEqual(sum(len(f.checks) for t in TABLES for f in t.fields), 318)
        self.assertEqual(sum(len(t.checks) for t in phase1_tables), 90)
        self.assertEqual(sum(len(f.checks) for t in phase1_tables for f in t.fields), 242)

    def test_exact_p0b_table_contracts(self):
        exact_checks = {
            "app_source_system": "source_system_id <> '00000000-0000-0000-0000-000000000000'",
            "ops_location": "location_id <> '00000000-0000-0000-0000-000000000000'",
            "ops_product": "product_id <> '00000000-0000-0000-0000-000000000000'",
            "ops_location_source_identity": "source_container_id IS NULL OR source_container_id <> ''",
            "ops_product_alias": "public.app_normalize_alias_v1(alias_text) <> ''",
            "scm_material_alias": "public.app_normalize_alias_v1(alias_text) <> ''",
            "finance_period_category_map": "source_sub IS NULL OR source_sub <> '__HOTCRUSH_ALL__'",
        }
        for table_name, check in exact_checks.items():
            self.assertIn(check, TABLE_BY_NAME[table_name].checks)
        ingest = TABLE_BY_NAME["pos_ingest_batch"]
        names = [field.name for field in ingest.fields]
        self.assertEqual(names[names.index("dataset_code") + 1], "coverage_scope")
        coverage = next(field for field in ingest.fields if field.name == "coverage_scope")
        self.assertTrue(coverage.nullable)
        self.assertEqual(
            coverage.checks,
            ("coverage_scope IS NULL OR coverage_scope IN ('ALL_ORDER_ITEMS','MEMBER_FLAGGED_ONLY')",),
        )
        self.assertIn("(dataset_code = 'ORDER_ITEM') = (coverage_scope IS NOT NULL)", ingest.checks)
        listing = TABLE_BY_NAME["pos_product_listing"]
        fields = {field.name: field for field in listing.fields}
        for field_name in POS_PRODUCT_LISTING_ORDINARY_TEXT_FIELDS:
            self.assertEqual(vocabulary_kind("pos_product_listing", field_name), "NONE")
            self.assertEqual(fields[field_name].checks, ())

    def test_cost_card_and_hbti_legacy_contracts_are_fail_closed(self):
        category_code = next(field for field in TABLE_BY_NAME["ops_product"].fields if field.name == "category_code")
        self.assertFalse(category_code.nullable)
        self.assertEqual(category_code.default, None)
        self.assertEqual(
            category_code.checks,
            ("category_code ~ '^[A-Z][A-Z0-9_]{1,63}$'",),
        )

        exact_nullable_contracts = {
            ("cost_card_recipe_version", "effective_from"):
                "effective_from IS NOT NULL OR (status = 'DRAFT' AND effective_to IS NULL)",
            ("mkt_campaign_version", "starts_at"):
                "starts_at IS NOT NULL OR (status = 'ARCHIVED' AND ends_at IS NULL)",
            ("mkt_survey_response", "started_at"):
                "started_at IS NOT NULL OR (submitted_at IS NOT NULL AND status IN ('SUBMITTED','VALIDATED','REJECTED'))",
            ("mkt_survey_result", "input_sha256"):
                "input_sha256 IS NOT NULL OR quality_status = 'INCOMPLETE_INPUT'",
        }
        for (table_name, field_name), expected_check in exact_nullable_contracts.items():
            table = TABLE_BY_NAME[table_name]
            field = next(item for item in table.fields if item.name == field_name)
            self.assertTrue(field.nullable, f"{table_name}.{field_name}")
            self.assertEqual(field.default, None, f"{table_name}.{field_name}")
            self.assertIn(expected_check, table.checks, table_name)

    def test_every_view_has_explicit_readiness_and_approved_grain(self):
        self.assertEqual(set(EXPECTED_GRAIN_KEYS), set(VIEW_BY_NAME))
        self.assertEqual(
            {name: getattr(view, "grain_key", "MISSING") for name, view in VIEW_BY_NAME.items()},
            EXPECTED_GRAIN_KEYS,
        )
        counts = Counter(getattr(view, "readiness_status", "MISSING") for view in VIEWS)
        self.assertEqual(
            counts,
            Counter({
                "PASS_SELECT_SPEC": 10,
                "FIX_MODEL_CONTRACT": 9,
                "BLOCK_MISSING_FACT_OR_RULE": 22,
                "DEFER_EXTENSION": 13,
                "DEFER_SOURCE": 5,
            }),
        )
        self.assertEqual({v.name for v in VIEWS if v.readiness_status == "PASS_SELECT_SPEC"}, PASS_VIEWS)
        self.assertEqual({v.name for v in VIEWS if v.readiness_status == "FIX_MODEL_CONTRACT"}, FIX_VIEWS)
        for view in VIEWS:
            if view.readiness_status == "PASS_SELECT_SPEC":
                self.assertEqual(view.readiness_blockers, ())
            else:
                self.assertTrue(view.readiness_blockers)
                self.assertTrue(all(code and code == code.upper() and " " not in code for code in view.readiness_blockers))
        identity_gap = VIEW_BY_NAME["v_identity_mapping_gap"]
        self.assertEqual(identity_gap.readiness_status, "BLOCK_MISSING_FACT_OR_RULE")
        self.assertIn("UNDEFINED_GRAIN_KEY", identity_gap.readiness_blockers)
        self.assertEqual([v.name for v in VIEWS if v.grain_key is None], ["v_identity_mapping_gap"])

    def test_grain_key_fields_exist_and_nullable_semantics_are_documented(self):
        for view in VIEWS:
            if view.grain_key is None:
                continue
            fields = {field.name: field for field in view.fields}
            self.assertFalse(set(view.grain_key) - set(fields), view.name)
            nullable_keys = [name for name in view.grain_key if fields[name].nullable]
            if nullable_keys:
                self.assertIn("NULLS NOT DISTINCT", view.notes, view.name)
        self.assertIn(
            "num_nonnulls(output_product_id, output_material_id) = 1",
            VIEW_BY_NAME["v_cost_card_recipe_current"].notes,
        )
        self.assertIn(
            "num_nonnulls(product_id, category_code) = 1",
            VIEW_BY_NAME["v_ops_holiday_factor"].notes,
        )

    def test_forecast_and_lineage_corrections(self):
        forecast = VIEW_BY_NAME["v_ops_forecast_accuracy"]
        fields = [field.name for field in forecast.fields]
        self.assertEqual(fields[fields.index("business_date") + 1], "forecast_run_id")
        run_id = next(field for field in forecast.fields if field.name == "forecast_run_id")
        self.assertFalse(run_id.nullable)
        self.assertEqual(run_id.data_type, "uuid")
        expected_lineage_additions = {
            "v_cost_card_recipe_expanded": {"scm_material_unit_conversion"},
            "v_scm_supplier_item_current_mapping": {"scm_material", "scm_material_unit_conversion"},
            "v_scm_supplier_price_current": {"scm_material", "scm_material_unit_conversion"},
            "v_cost_card_product_cost_component": {"ops_production_plan_line", "ops_location"},
            "v_ops_timeslot_sales_baseline": {"ops_location", "ops_business_rule"},
            "v_ops_holiday_factor": {"ops_location"},
        }
        for view_name, additions in expected_lineage_additions.items():
            self.assertTrue(additions <= set(VIEW_BY_NAME[view_name].lineage), view_name)
        self.assertIn("v_ops_daily_review_current", VIEW_BY_NAME["v_ops_manager_sales_reconciliation"].lineage)
        self.assertNotIn("ops_daily_review", VIEW_BY_NAME["v_ops_manager_sales_reconciliation"].lineage)
        self.assertEqual(
            VIEW_BY_NAME["v_cost_card_product_cost_quality"].lineage,
            ("v_cost_card_product_cost_snapshot",),
        )


class P0cContractTest(unittest.TestCase):
    def test_composite_foreign_key_is_explicit_and_typed(self):
        claim = TABLE_BY_NAME["mkt_reward_claim"]
        self.assertEqual(
            claim.foreign_keys,
            (
                TableForeignKey(
                    columns=("reward_stock_id", "reward_id"),
                    ref_table="mkt_reward_stock",
                    ref_columns=("reward_stock_id", "reward_id"),
                    fk_activation="WITH_TABLE",
                    match_type="SIMPLE",
                ),
            ),
        )

    def test_reward_claim_models_fulfillment_without_inventing_stock(self):
        claim = TABLE_BY_NAME["mkt_reward_claim"]
        fields = {field.name: field for field in claim.fields}
        self.assertIn("reward_id", fields)
        self.assertEqual(fields["reward_id"].fk, "mkt_reward.reward_id")
        self.assertFalse(fields["reward_id"].nullable)
        self.assertTrue(fields["reward_stock_id"].nullable)
        self.assertIsNone(fields["reward_stock_id"].fk)
        self.assertFalse(fields["reward_stock_id"].pk)
        self.assertIsNone(fields["reward_stock_id"].default)
        self.assertNotIn("source_redemption_id", fields)
        self.assertIn("source_fulfillment_id", fields)
        self.assertTrue(fields["reserved_at"].nullable)
        self.assertEqual(
            fields["source_fulfillment_id"].checks,
            ("source_fulfillment_id IS NULL OR btrim(source_fulfillment_id) <> ''",),
        )
        for check in (
            "expires_at IS NULL OR (reserved_at IS NOT NULL AND expires_at > reserved_at)",
            "(source_system_id IS NULL) = (source_fulfillment_id IS NULL)",
            "reward_stock_id IS NOT NULL OR (source_system_id IS NOT NULL AND source_fulfillment_id IS NOT NULL)",
            "status <> 'REDEEMED' OR redeemed_at IS NOT NULL",
        ):
            self.assertIn(check, claim.checks)

    def test_reward_stock_cost_and_identity_are_fail_closed(self):
        stock = TABLE_BY_NAME["mkt_reward_stock"]
        fields = {field.name: field for field in stock.fields}
        self.assertTrue(fields["currency"].nullable)
        self.assertIsNone(fields["currency"].default)
        self.assertIn("(unit_cost_estimate IS NULL) = (currency IS NULL)", stock.checks)
        self.assertIn(("reward_stock_id", "reward_id"), stock.uniques)

    def test_result_only_responses_use_nullable_attempt_anchor(self):
        response = TABLE_BY_NAME["mkt_survey_response"]
        fields = {field.name: field for field in response.fields}
        self.assertTrue(fields["attempt_no"].nullable)
        self.assertEqual(fields["attempt_no"].checks, ("attempt_no IS NULL OR attempt_no > 0",))
        self.assertIn(("campaign_member_id", "attempt_no"), response.nulls_not_distinct_uniques)
        self.assertIn("migration-only:", fields["source_response_id"].description)
        self.assertIn("不得冒充来源作答尝试", fields["source_response_id"].purpose)

    def test_p0c_golden_counts_and_unique_subtypes(self):
        phase1_names = CORE_BUSINESS_TABLES | CORE_PLATFORM_TABLES
        phase1_tables = [table for table in TABLES if table.name in phase1_names]

        def fk_count(tables):
            return sum(
                sum(field.fk is not None for field in table.fields) + len(table.foreign_keys)
                for table in tables
            )

        self.assertEqual(len(TABLES), 137)
        self.assertEqual(len(VIEWS), 59)
        self.assertEqual(sum(len(t.fields) for t in TABLES), 1812)
        self.assertEqual(sum(len(v.fields) for v in VIEWS), 643)
        self.assertEqual(fk_count(TABLES), 420)
        self.assertEqual(sum(len(t.checks) for t in TABLES), 115)
        self.assertEqual(sum(len(f.checks) for t in TABLES for f in t.fields), 318)
        self.assertEqual(sum(len(t.uniques) for t in TABLES), 134)
        self.assertEqual(sum(len(t.fields) for t in phase1_tables), 1374)
        self.assertEqual(sum(len(v.fields) for v in VIEWS if v.name in PHASE1_VIEWS), 471)
        self.assertEqual(fk_count(phase1_tables), 291)
        self.assertEqual(sum(len(t.checks) for t in phase1_tables), 90)
        self.assertEqual(sum(len(f.checks) for t in phase1_tables for f in t.fields), 242)
        self.assertEqual(sum(len(t.uniques) for t in phase1_tables), 102)

        all_unique_subtypes = Counter()
        phase1_unique_subtypes = Counter()
        for table in TABLES:
            for unique in table.uniques:
                if unique in table.nulls_not_distinct_uniques:
                    kind = "NND"
                elif unique in table.nulls_distinct_uniques:
                    kind = "ND"
                else:
                    kind = "ORDINARY"
                all_unique_subtypes[kind] += 1
                if table in phase1_tables:
                    phase1_unique_subtypes[kind] += 1
        self.assertEqual(all_unique_subtypes, Counter({"ORDINARY": 102, "NND": 15, "ND": 17}))
        self.assertEqual(phase1_unique_subtypes, Counter({"ORDINARY": 78, "NND": 9, "ND": 15}))

    def test_source_fidelity_aggregates_and_allowlist_are_frozen(self):
        summary = validate_source_fidelity_contracts()
        self.assertEqual(COST_ITEM_SOURCE_AUDIT["row_count"], 471)
        self.assertEqual(COST_ITEM_SOURCE_AUDIT["route_counts"]["PRODUCT"], 99)
        self.assertEqual(sum(COST_ITEM_SOURCE_AUDIT["material_routes"].values()), 372)
        self.assertEqual(COST_RECIPE_OUTPUT_AUDIT["product_output"], {"version_count": 104, "family_count": 99})
        self.assertEqual(COST_RECIPE_OUTPUT_AUDIT["semi_finished_output"], {"version_count": 185, "family_count": 171})
        self.assertEqual(len(REWARD_TEMPLATE_ALLOWLIST), 10)
        self.assertEqual(REWARD_TEMPLATE_ALLOWLIST_SHA256, REWARD_TEMPLATE_ALLOWLIST_EXPECTED_SHA256)
        self.assertEqual(summary["reward_template_route_count"], 10)
        self.assertEqual(HBTI_RESULT_ONLY_ANCHOR_CONTRACT["uuid5_root"], "7ab6debe-4d90-50e2-ab29-9873d96e848d")
        self.assertFalse(HBTI_RESULT_ONLY_ANCHOR_CONTRACT["source_observation"])
        self.assertEqual(REWARD_SOURCE_AUDIT["butterfly_reconciliation_status"], "DRIFT")


if __name__ == "__main__":
    unittest.main()
