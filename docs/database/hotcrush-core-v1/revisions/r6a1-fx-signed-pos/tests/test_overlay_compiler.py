from __future__ import annotations

import ast
import csv
import hashlib
import io
import json
from pathlib import Path
import tempfile
import threading
import types
import unittest
from unittest import mock


REVISION_ROOT = Path(__file__).resolve().parents[1]
OVERLAY_PATH = REVISION_ROOT / "model-overlay.json"
COMPILER_PATH = REVISION_ROOT / "compiler.py"


def load_compiler():
    source = COMPILER_PATH.read_bytes()
    module = types.ModuleType("r6a1_overlay_compiler")
    module.__file__ = str(COMPILER_PATH)
    module.__dict__["__r6a1_executed_source_bytes__"] = source
    code = compile(source, str(COMPILER_PATH), "exec", dont_inherit=True)
    exec(code, module.__dict__, module.__dict__)
    return module


def reseal_payloads(compiler, bundle: dict[str, bytes], replacements: dict[str, bytes]):
    forged = dict(bundle)
    for name, content in replacements.items():
        if name not in compiler.PAYLOAD_NAMES:
            raise AssertionError(f"not a payload: {name}")
        forged[name] = content
        sidecar_name = f"{name}.sha256"
        forged[sidecar_name] = (
            f"{hashlib.sha256(content).hexdigest()}  {name}\n"
        ).encode("ascii")
    manifest = json.loads(bundle["manifest.json"])
    for row in manifest["outputs"]:
        row["sha256"] = hashlib.sha256(forged[row["path"]]).hexdigest()
        row["size_bytes"] = len(forged[row["path"]])
    forged["manifest.json"] = compiler._canonical_source_bytes(manifest)
    forged["manifest.json.sha256"] = (
        f"{hashlib.sha256(forged['manifest.json']).hexdigest()}  manifest.json\n"
    ).encode("ascii")
    return forged


class R6A1OverlayCompilerTests(unittest.TestCase):
    def test_exact_schema_gate_must_be_approved_before_generation(self) -> None:
        self.assertTrue(OVERLAY_PATH.is_file(), "model-overlay.json is missing")
        overlay = json.loads(OVERLAY_PATH.read_text(encoding="utf-8"))
        self.assertEqual(
            overlay["exact_schema_status"],
            "APPROVED_DDL_LEVEL_CONTRACT",
            "requested counts cannot substitute for the missing exact changed-table schema",
        )

    def test_repository_baseline_matches_all_raw_and_canonical_pins(self) -> None:
        compiler = load_compiler()
        verified = compiler.verify_baseline_pins()
        self.assertEqual(
            verified["model"]["raw_sha256"],
            "7bd5a71b010ad89427d918b842a18c4c34e23085cef0543cad14703d097c187b",
        )
        self.assertEqual(
            verified["model"]["canonical_sha256"],
            "52b1e84ae5cfa16871a058adaca3d1482d91460f7aad6f99186cab5b7e4ed986",
        )
        self.assertEqual(
            verified["catalog"]["raw_sha256"],
            "a3308bfe34499d3484f97bed744b101915a9a1c105c919f8c056ee8940d3c2ea",
        )
        self.assertEqual(verified["review_package"]["file_count"], 54)
        self.assertEqual(
            verified["review_package"]["aggregate_sha256"],
            "6b863293c5aa3358c45c52468f614583f309ccb8a3ea717f3ad90ad76dfceaa0",
        )

    def test_build_input_manifest_closes_every_actual_source_file(self) -> None:
        compiler = load_compiler()
        inputs = compiler.build_input_manifest()
        paths = [entry["path"] for entry in inputs]
        self.assertEqual(paths, sorted(paths))
        self.assertEqual(len(paths), len(set(paths)))
        self.assertEqual(len(paths), 57)
        self.assertIn("target-model.json", paths)
        self.assertIn("implementation/phase1-catalog-contract.json", paths)
        self.assertNotIn("revisions/r6a1-fx-signed-pos/bootstrap.py", paths)
        self.assertIn(
            "revisions/r6a1-fx-signed-pos/model-overlay.json", paths
        )
        self.assertIn("revisions/r6a1-fx-signed-pos/compiler.py", paths)
        for entry in inputs:
            self.assertEqual(set(entry), {"path", "sha256", "size_bytes"})
            self.assertEqual(len(entry["sha256"]), 64)
            self.assertFalse(Path(entry["path"]).is_absolute())

    def test_build_uses_one_immutable_snapshot_and_binds_startup_compiler_bytes(self) -> None:
        compiler = load_compiler()
        source_bytes = COMPILER_PATH.read_bytes()
        unbound = types.ModuleType("r6a1_unbound_compiler")
        unbound.__file__ = str(COMPILER_PATH)
        exec(
            compile(
                source_bytes, str(COMPILER_PATH), "exec", dont_inherit=True
            ),
            unbound.__dict__,
            unbound.__dict__,
        )
        with self.assertRaises(unbound.OverlayContractError) as bootstrap:
            unbound.build_package()
        self.assertEqual(
            bootstrap.exception.code, "compiler_bootstrap_required"
        )

        snapshot = compiler._capture_input_snapshot(None)
        with self.assertRaises(TypeError):
            snapshot["forged"] = b"forged"
        compiler_relative = (
            "revisions/r6a1-fx-signed-pos/compiler.py"
        )
        self.assertEqual(
            snapshot[compiler_relative], compiler._STARTUP_COMPILER_SOURCE_BYTES
        )
        self.assertEqual(
            compiler._EXECUTION_SOURCE_BINDING_MODE,
            "BYTE_CARRYING_COMPILE_EXEC_BOOTSTRAP",
        )
        with mock.patch.object(
            compiler,
            "_read_regular_file_uncached",
            side_effect=AssertionError("later disk bytes must not be consumed"),
        ):
            self.assertEqual(
                compiler._read_regular_file(COMPILER_PATH),
                snapshot[compiler_relative],
            )
            direct_manifest = compiler.build_input_manifest()
        compiler_row = next(
            row for row in direct_manifest if row["path"] == compiler_relative
        )
        self.assertEqual(
            compiler_row["sha256"],
            hashlib.sha256(compiler._STARTUP_COMPILER_SOURCE_BYTES).hexdigest(),
        )


    def test_baseline_phase1_counts_are_recomputed_from_catalog_rows(self) -> None:
        compiler = load_compiler()
        overlay = compiler.load_overlay()
        self.assertEqual(
            compiler.recompute_baseline_phase1_counts(),
            overlay["golden_counts"]["baseline_phase1"],
        )

    def test_resolved_phase1_counts_are_recomputed_from_the_resolved_model(self) -> None:
        compiler = load_compiler()
        overlay = compiler.load_overlay()
        resolved = compiler.build_resolved_model(overlay)
        recomputed = compiler.recompute_resolved_phase1_counts(resolved)
        self.assertEqual(
            recomputed,
            {
                "active_foreign_keys": 332,
                "catalog_total_indexes": 505,
                "check_constraints": 404,
                "column_comments": 1470,
                "columns": 1470,
                "constraint_comments": 975,
                "exclusion_constraints": 21,
                "foreign_key_support_indexes": 266,
                "index_comments": 266,
                "primary_keys": 105,
                "sql_views": 0,
                "table_comments": 105,
                "tables": 105,
                "unique_constraints": 113,
            },
        )
        self.assertEqual(
            recomputed["table_comments"]
            + recomputed["column_comments"]
            + recomputed["constraint_comments"]
            + recomputed["index_comments"],
            2816,
        )
        self.assertEqual(
            compiler._analyze_resolved_phase1(resolved)["unique_subtypes"],
            {
                "ordinary": 87,
                "nulls_distinct": 16,
                "nulls_not_distinct": 10,
            },
        )

    def test_operation_receipt_identity_is_a_typed_relational_model_delta(self) -> None:
        overlay = json.loads(OVERLAY_PATH.read_text(encoding="utf-8"))
        item = next(
            row
            for row in overlay["affected_table_contracts"]
            if row["object_name"] == "app_audit_event"
        )
        contract = item["contract"]
        operation = contract["fields"][8]
        self.assertEqual(item["operation"], "REPLACE_TABLE")
        self.assertEqual(item["requested_field_count"], 15)
        self.assertEqual(operation["name"], "operation_id")
        self.assertEqual(operation["data_type"], "uuid")
        self.assertTrue(operation["nullable"])
        self.assertIsNone(operation["default"])
        self.assertEqual(
            operation,
            {
                "checks": [],
                "data_type": "uuid",
                "default": None,
                "description": "五个 R6A1 受控成功主动作的幂等操作身份；普通审计事件为空。",
                "example": "77777777-7777-4777-8777-777777777777",
                "fk": None,
                "fk_activation": "WITH_TABLE",
                "name": "operation_id",
                "notes": "与 action_code 共同提供一次逻辑命令的并发仲裁；不替代可跨多条日志复用的 request_id。",
                "nullable": True,
                "pk": False,
                "purpose": "支持 commit-unknown 后按同一动作和操作身份安全重放，并拒绝同身份不同输入。",
                "sensitive": "none",
                "unique": False,
                "zh_name": "操作幂等ID",
            },
        )
        self.assertEqual(
            contract["checks"],
            [
                "((operation_id IS NOT NULL) = (result = 'SUCCESS' AND action_code IN "
                "('R6A1_FX_RATE_OBSERVATION_WRITE','R6A1_MATERIAL_PRICE_OBSERVATION_INSERT',"
                "'R6A1_MATERIAL_PRICE_OBSERVATION_VERIFY','R6A1_MATERIAL_COST_SELECTION_WRITE',"
                "'R6A1_MATERIAL_PRICE_OBSERVATION_RESTORE'))) AND (operation_id IS NULL OR "
                "operation_id <> '00000000-0000-0000-0000-000000000000'::uuid)"
            ],
        )
        operation_key = [["action_code", "operation_id"]]
        self.assertEqual(contract["uniques"], operation_key)
        self.assertEqual(contract["nulls_distinct_uniques"], operation_key)
        self.assertEqual(contract["nulls_not_distinct_uniques"], [])
        expected_notes = {
            "app_audit_event": "object_type/object_id 是审计元数据，不是业务关系。业务查询必须使用各域真实外键；删除或改名业务对象不会级联修改审计流水。object_type 受域前缀格式约束，object_id 受 UUID 类型约束，仍不能据此声称数据库验证了它指向哪张表。R6A1 的 operation_id 只用于五个受控 SUCCESS 主动作，以 (action_code,operation_id) 提供幂等并发仲裁；request_id 仍是可跨多条事件和写者复用的追踪号，不参与唯一性或输入指纹。普通非 R6A1 审计事件 operation_id 必须为空。五个主动作的 before_data/after_data 仅保存严格脱敏投影和 typed hash，不复制完整业务行或受限证据。",
            "scm_material_price_observation": "只有 VERIFIED 且 zero_price_reason_code=CONTRACTUAL_FREE_OF_CHARGE 的零价可供 MATERIAL_COST/PURCHASE_PRICE_ONLY 选择；其它真实零价不表示持续采购成本，SOURCE_PLACEHOLDER 只能 REJECTED。NND 前驱键禁止分叉；触发器验证同 source/record 当前终态、无环、interpretation_contract_version 递增、自动核验 audit provenance、单位/原料复合身份和核心不可变。R6A1 当前在线 insert writer 仅创建 supersedes_material_price_observation_id=NULL 的 UNVERIFIED root；在线 verify writer 仅允许 ACTIVE/HUMAN 执行 UNVERIFIED→VERIFIED。模型允许的 supersession 与 verified_by_user_id=NULL 自动核验历史仅可由签名 S0 maintenance RESTORE 恢复并由 receipt/full verifier 证明。PROCUREMENT_AND_INVENTORY 扩展 FK 激活前，PO_CONFIRMED、RECEIPT_ACTUAL 及其证据 ID 均拒绝。",
            "finance_currency_assignment": "排斥约束为 DEFERRABLE INITIALLY IMMEDIATE。触发器须验证作用域/币种状态，批准后核心字段冻结，仅允许受控关闭或退役，且不得缩短到依赖 policy/selection 之外。GROUP 与 PRESENTATION 均未批准。R6A1 将 approved_at 定义为首次批准时间，批准后不得在退役或关闭时改写；退役操作者与时间只进入审计 receipt。",
            "finance_currency_policy": "排斥约束为 DEFERRABLE INITIALLY IMMEDIATE。复合外键钉住 assignment 及 target currency。触发器须验证 policy 区间被 assignment 包含、批准状态/目标币种一致、批准后核心字段冻结且缩短不得悬空 selection。DOWN 明确定义为 toward-zero。R6A1 将 approved_at 定义为首次批准时间，批准后不得在退役或关闭时改写；退役操作者与时间只进入审计 receipt。",
        }
        by_name = {
            row["object_name"]: row["contract"]
            for row in overlay["affected_table_contracts"]
        }
        self.assertEqual(
            {name: by_name[name]["notes"] for name in expected_notes},
            expected_notes,
        )

    def test_resolved_audits_and_chains_do_not_retain_superseded_grains_or_myr_formula(self) -> None:
        compiler = load_compiler()
        resolved = compiler.build_resolved_model()
        audits = {
            row["table_name"]: row for row in resolved["minimum_grain_audits"]
        }
        self.assertEqual(audits["scm_material_price_observation"]["derived_fields"], [])
        self.assertNotIn(
            "normalized_price_myr",
            json.dumps(audits["scm_material_price_observation"], ensure_ascii=False),
        )
        self.assertIn(
            "raw reversal line", audits["pos_order_item"]["physical_reason"]
        )
        chain = next(row for row in resolved["end_to_end_chains"] if row["number"] == 13)
        self.assertNotIn("source_row_count", json.dumps(chain, ensure_ascii=False))
        self.assertIn("source_order_item_id", chain["joins"][0])

    def test_disputed_table_contracts_are_exact_and_closed(self) -> None:
        compiler = load_compiler()
        overlay = compiler.load_overlay()
        by_name = {
            item["object_name"]: item["contract"]
            for item in overlay["affected_table_contracts"]
        }
        expected_fields = {
            "finance_fx_rate_observation": 18,
            "scm_material_price_observation": 24,
            "cost_card_material_cost_selection": 19,
            "finance_currency_policy": 24,
        }
        for name, count in expected_fields.items():
            self.assertEqual(len(by_name[name]["fields"]), count)
        fx = by_name["finance_fx_rate_observation"]
        fx_fields = {field["name"]: field for field in fx["fields"]}
        self.assertEqual(fx_fields["rate"]["data_type"], "numeric(38,18)")
        self.assertEqual(fx_fields["verified_by_user_id"]["nullable"], True)
        self.assertEqual(
            len(fx["checks"]) + sum(len(field["checks"]) for field in fx["fields"]),
            12,
        )
        self.assertEqual(len(fx["uniques"]), 2)
        price = by_name["scm_material_price_observation"]
        self.assertEqual(
            len(price["checks"])
            + sum(len(field["checks"]) for field in price["fields"]),
            14,
        )
        self.assertEqual(len(price["uniques"]), 2)
        selection = by_name["cost_card_material_cost_selection"]
        self.assertIn("target_currency_assignment_id", {
            field["name"] for field in selection["fields"]
        })
        self.assertEqual(
            len(selection["checks"])
            + sum(len(field["checks"]) for field in selection["fields"]),
            9,
        )
        self.assertEqual(len(selection["foreign_keys"]), 3)
        policy_fields = {field["name"]: field for field in by_name[
            "finance_currency_policy"
        ]["fields"]}
        self.assertEqual(policy_fields["max_rate_age_seconds"]["data_type"], "integer")
        self.assertTrue(policy_fields["max_rate_age_seconds"]["nullable"])
        self.assertIsNone(policy_fields["max_rate_age_seconds"]["default"])

    def test_parent_reference_key_closure_is_explicit(self) -> None:
        compiler = load_compiler()
        overlay = compiler.load_overlay()
        by_name = {
            item["object_name"]: item["contract"]
            for item in overlay["affected_table_contracts"]
        }
        self.assertIn(
            ["supplier_item_id", "material_id"],
            by_name["scm_supplier_item"]["uniques"],
        )
        self.assertIn(
            ["material_unit_conversion_id", "material_id", "from_unit_id"],
            by_name["scm_material_unit_conversion"]["uniques"],
        )
        compiler.validate_resolved_model_contracts(compiler.build_resolved_model(overlay))

    def test_affected_table_contracts_pin_each_before_table_or_absence(self) -> None:
        compiler = load_compiler()
        self.assertEqual(
            compiler.verify_schema_contract_baselines(),
            {
                "future_existing_tables_pinned": 5,
                "phase1_additions_absent": 5,
                "phase1_existing_tables_pinned": 27,
            },
        )
        overlay = compiler.load_overlay()
        by_name = {
            item["object_name"]: item
            for item in overlay["affected_table_contracts"]
        }
        self.assertEqual(
            by_name["scm_material_price_observation"]["baseline_object_name"],
            "scm_supplier_price_observation",
        )
        self.assertEqual(
            by_name["cost_card_material_cost_selection"]["baseline_object_name"],
            "cost_card_material_price",
        )

    def test_overlay_is_canonical_closed_and_rejects_hostile_json(self) -> None:
        compiler = load_compiler()
        content = OVERLAY_PATH.read_bytes()
        compiler.load_overlay_bytes(content)

        with self.assertRaises(compiler.OverlayContractError) as duplicate:
            compiler.load_overlay_bytes(b'{"same":1,"same":2}')
        self.assertEqual(duplicate.exception.code, "duplicate_json_key")

        with self.assertRaises(compiler.OverlayContractError) as dangerous:
            compiler.load_overlay_bytes(b'{"__proto__":{}}')
        self.assertEqual(dangerous.exception.code, "dangerous_json_key")

        overlay = json.loads(content)
        overlay["unexpected"] = True
        unknown_bytes = (
            json.dumps(overlay, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        ).encode("utf-8")
        with self.assertRaises(compiler.OverlayContractError) as unknown:
            compiler.load_overlay_bytes(unknown_bytes)
        self.assertEqual(unknown.exception.code, "closed_schema_violation")

        class BytesSubclass(bytes):
            pass

        with self.assertRaises(compiler.OverlayContractError) as subclass:
            compiler.load_overlay_bytes(BytesSubclass(content))
        self.assertEqual(subclass.exception.code, "bytes_required")

        overlay = json.loads(content)
        overlay["affected_table_contracts"][0]["object_name"] = []
        wrong_scalar = (
            json.dumps(overlay, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        ).encode("utf-8")
        with self.assertRaises(compiler.OverlayContractError) as invalid_scalar:
            compiler.load_overlay_bytes(wrong_scalar)
        self.assertEqual(invalid_scalar.exception.code, "invalid_scalar")

        for key, unsafe_value in (
            ("schema_version", "UNKNOWN"),
            ("revision_id", "NOT-R6A1"),
            ("status", "APPLY_COMPATIBLE"),
        ):
            unsafe = json.loads(content)
            unsafe[key] = unsafe_value
            unsafe_bytes = (
                json.dumps(unsafe, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
            ).encode("utf-8")
            with self.assertRaises(compiler.OverlayContractError) as identity:
                compiler.load_overlay_bytes(unsafe_bytes)
            self.assertEqual(identity.exception.code, "overlay_identity_mismatch")

        wrong_boolean = json.loads(content)
        wrong_boolean["pos_source_probe_boundary"]["sales_hour"]["null_count"] = False
        wrong_boolean_bytes = (
            json.dumps(wrong_boolean, ensure_ascii=False, indent=2, sort_keys=True)
            + "\n"
        ).encode("utf-8")
        with self.assertRaises(compiler.OverlayContractError) as type_error:
            compiler.load_overlay_bytes(wrong_boolean_bytes)
        self.assertEqual(type_error.exception.code, "pos_source_probe_boundary_mismatch")

    def test_all_changed_table_contracts_are_approved_with_exact_field_counts(self) -> None:
        overlay = json.loads(OVERLAY_PATH.read_text(encoding="utf-8"))
        baseline = overlay["golden_counts"]["baseline_phase1"]
        self.assertEqual(baseline["tables"], 100)
        self.assertEqual(baseline["columns"], 1374)
        self.assertTrue(
            all(
                isinstance(item["contract"], dict)
                and item["exact_schema_status"] == "APPROVED_DDL_LEVEL_CONTRACT"
                and item["requested_field_count"] == len(item["contract"]["fields"])
                for item in (
                    overlay["affected_table_contracts"]
                    + overlay["future_affected_table_contracts"]
                )
            )
        )

    def test_affected_table_sets_equal_paths_union_direct_changes(self) -> None:
        compiler = load_compiler()
        overlay = compiler.load_overlay()
        derived = compiler.derive_affected_table_contract_names()
        phase1 = tuple(
            sorted(item["object_name"] for item in overlay["affected_table_contracts"])
        )
        future = tuple(
            sorted(
                item["object_name"]
                for item in overlay["future_affected_table_contracts"]
            )
        )
        self.assertEqual(phase1, derived["phase1"])
        self.assertEqual(future, derived["future"])
        self.assertEqual(len(phase1), 32)
        self.assertEqual(len(future), 5)
        self.assertIn("scm_supplier_item", phase1)
        self.assertIn("scm_material_unit_conversion", phase1)
        self.assertIn("app_audit_event", phase1)

    def test_old_requested_counts_stay_superseded_and_resolved_counts_are_asserted(self) -> None:
        overlay = json.loads(OVERLAY_PATH.read_text(encoding="utf-8"))
        counts = overlay["golden_counts"]
        self.assertEqual(
            counts["target_status"],
            "RESOLVED_MODEL_COUNTS_ASSERTED_BY_INDEPENDENT_RECOMPUTE",
        )
        self.assertEqual(counts["minimum_phase1_table_count"], 105)
        self.assertNotIn("requested_target_phase1", counts)
        self.assertIn("superseded_requested_target_phase1", counts)
        self.assertEqual(
            counts["target_blockers"],
            [
                "NEW_SQL_PAYLOAD_AND_RELEASE_PINS_REQUIRED",
                "CONSTRAINT_TRIGGER_DDL_NOT_COMPILED",
                "LATEST_S0_CONSERVATION_REQUIRED",
                "RECIPE_ARCHIVE_ROUTE_MANIFEST_REQUIRED",
            ],
        )

    def test_group_reporting_is_deferred_without_a_stable_scope_identity(self) -> None:
        overlay = json.loads(OVERLAY_PATH.read_text(encoding="utf-8"))
        decision = next(
            item
            for item in overlay["approved_decisions"]
            if item["decision_id"] == "FX-004"
        )
        self.assertEqual(decision["status"], "APPROVED_FAIL_CLOSED_BOUNDARY")
        self.assertEqual(
            decision["unresolved"],
            [
                "DEFER_GROUP_REPORTING_IDENTITY_REQUIRED",
                "ENTITY_PRESENTATION_SCOPE_NOT_APPROVED",
                "LOCATION_ACCOUNTING_ENTITY_EFFECTIVE_RELATION_DEFERRED",
            ],
        )
        self.assertIn("NULL scope is not a group default", decision["summary"])

    def test_five_table_currency_model_has_no_location_currency_dual_source(self) -> None:
        overlay = json.loads(OVERLAY_PATH.read_text(encoding="utf-8"))
        by_name = {
            item["object_name"]: item
            for item in overlay["affected_table_contracts"]
        }
        assignment = by_name["finance_currency_assignment"]
        self.assertEqual(assignment["operation"], "ADD_TABLE")
        self.assertIsNone(assignment["baseline_object_name"])
        self.assertEqual(assignment["requested_field_count"], 17)
        self.assertEqual(by_name["ops_location"]["requested_field_count"], 15)
        self.assertIn("finance_accounting_entity", by_name)
        self.assertNotIn("finance_legal_entity", by_name)
        decision = next(
            item
            for item in overlay["approved_decisions"]
            if item["decision_id"] == "FX-004"
        )
        self.assertIn("LOCATION/OPERATING", decision["summary"])
        self.assertIn("ACCOUNTING_ENTITY/FUNCTIONAL", decision["summary"])
        self.assertNotIn("ENTITY_PRESENTATION currency", decision["summary"])
        self.assertIn("pair-specific conversion", decision["summary"])

    def test_recipe_reference_price_uses_approved_archive_route_c(self) -> None:
        overlay = json.loads(OVERLAY_PATH.read_text(encoding="utf-8"))
        decision = next(
            item
            for item in overlay["approved_decisions"]
            if item["decision_id"] == "COST-001"
        )
        self.assertEqual(decision["status"], "APPROVED_ARCHIVE_ROUTE_C")
        self.assertEqual(
            decision["unresolved"],
            [
                "RECIPE_ARCHIVE_ROUTE_MANIFEST_REQUIRED",
                "COST_SELECTION_CONSTRAINT_TRIGGER_DDL_NOT_COMPILED",
            ],
        )
        self.assertIn("DROP reference_sale_price and currency", decision["summary"])
        self.assertIn("authenticated encrypted S0 or migration archive", decision["summary"])
        self.assertIn("never participates in margin", decision["summary"])
        by_name = {
            item["object_name"]: item
            for item in overlay["affected_table_contracts"]
        }
        recipe = by_name["cost_card_recipe_version"]
        self.assertEqual(recipe["requested_field_count"], 18)
        self.assertEqual(
            recipe["contract"]["purpose"],
            "一行冻结一个配方代码版本的名称、产出对象、批产量、生效区间和发布治理。",
        )
        self.assertNotIn("售价参考", recipe["contract"]["purpose"])
        self.assertNotIn("reference_sale", recipe["contract"]["purpose"])

    def test_currency_changed_path_sets_are_exact_and_closed(self) -> None:
        overlay = json.loads(OVERLAY_PATH.read_text(encoding="utf-8"))
        self.assertEqual(
            overlay["approved_changed_paths"],
            {
                "future_currency_default_removals_and_fk_additions": [
                    "pos_payment.currency",
                    "pos_refund.currency",
                    "scm_goods_receipt_line.currency",
                    "scm_inventory_movement_line.currency",
                    "scm_purchase_order_revision.currency",
                ],
                "phase1_currency_default_removals_and_fk_additions": [
                    "finance_cashflow_line.currency",
                    "finance_item_sales_monthly.currency",
                    "finance_monthly_cost_line.currency",
                    "finance_order_logistics_line.currency",
                    "finance_sales_daily.currency",
                    "finance_supplier_purchase_monthly.currency",
                    "ops_daily_review.manager_currency",
                    "ops_stockout_event.currency",
                    "pos_daily_breakdown.currency",
                    "pos_item_sales_hour.currency",
                    "pos_item_waste.currency",
                    "pos_member_balance_snapshot.currency",
                    "pos_member_card_transaction.currency",
                    "pos_member_daily_metric.currency",
                    "pos_order_item.currency",
                    "pos_product_listing.currency",
                    "pos_sales_day.currency",
                    "pos_sales_hour.currency",
                    "scm_material_price_observation.transaction_currency_code",
                    "scm_supplier.default_quote_currency_code",
                ],
                "phase1_currency_fk_additions_without_default": [
                    "mkt_reward_stock.currency"
                ],
                "phase1_non_currency_default_removals": [
                    "ops_location.business_day_cutoff",
                    "ops_location.country_code",
                    "ops_location.timezone_name",
                    "scm_supplier.country_code",
                ],
                "phase1_currency_field_removals": [
                    "cost_card_recipe_version.currency",
                    "ops_location.default_currency"
                ],
                "phase1_non_currency_field_removals": [
                    "cost_card_recipe_version.reference_sale_price"
                ],
                "phase1_parent_reference_unique_additions": [
                    "scm_material_unit_conversion.unique(material_unit_conversion_id,material_id,from_unit_id)",
                    "scm_supplier_item.unique(supplier_item_id,material_id)",
                ],
            },
        )

    def test_currency_changed_paths_match_the_pinned_baseline_before_state(self) -> None:
        compiler = load_compiler()
        verified = compiler.verify_currency_changed_path_baseline()
        self.assertEqual(
            verified,
            {
                "future_defaults_without_fk": 5,
                "phase1_defaults_without_fk": 20,
                "phase1_fields_removed": 2,
                "phase1_no_default_without_fk": 1,
                "phase1_non_currency_defaults_removed": 4,
                "phase1_non_currency_fields_removed": 1,
            },
        )

    def test_legacy_order_aggregate_is_reconciliation_only(self) -> None:
        overlay = json.loads(OVERLAY_PATH.read_text(encoding="utf-8"))
        self.assertEqual(
            overlay["mapping_overrides"],
            [
                {
                    "authoritative_source": "EXTERNAL_RES_REPORT211_RAW_REPLAY_PACKAGE",
                    "baseline_disposition": "MIGRATE_LATEST_SNAPSHOT",
                    "baseline_row_canonical_sha256": "6de89700be6d73e8d74577297291f7b568bdf68525bab0939d144e63651f6402",
                    "blockers": [
                        "RAW_RES_REPORT211_REPLAY_REQUIRED",
                        "RAW_SOURCE_ORDER_ITEM_ID_CONTRACT_REQUIRED",
                    ],
                    "forbidden_transformations": [
                        "LEGACY_AGGREGATE_TO_RAW_LINE_SPLIT",
                        "LEGACY_SOURCE_ROW_COUNT_MIGRATION",
                        "LEGACY_AGGREGATE_LINE_LEVEL_TARGET_INTENTS",
                    ],
                    "migration_mode": "RECONCILIATION_ONLY_NO_TARGET_INTENTS",
                    "source_object": "pos_member_order_item",
                    "status": "BLOCKED_PENDING_APPROVED_RAW_REPLAY_ARTIFACT",
                    "target_object": "pos_order_item",
                }
            ],
        )
        self.assertEqual(
            load_compiler().verify_raw_replay_mapping_baseline(),
            {
                "baseline_disposition": "MIGRATE_LATEST_SNAPSHOT",
                "baseline_row_canonical_sha256": "6de89700be6d73e8d74577297291f7b568bdf68525bab0939d144e63651f6402",
            },
        )

    def test_pos_order_item_partial_contract_uses_the_arbitrated_names_and_sign_policy(self) -> None:
        overlay = json.loads(OVERLAY_PATH.read_text(encoding="utf-8"))
        boundary = overlay["pos_order_item_contract_boundary"]
        self.assertEqual(
            boundary["added_field_names"],
            [
                "discount_promotion_amount",
                "gross_quantity",
                "gross_sales",
                "refund_amount",
                "refund_quantity",
                "source_order_item_id",
                "source_order_status_code",
                "source_reversal_order_code",
            ],
        )
        self.assertEqual(boundary["renamed_fields"], {"quantity": "net_quantity"})
        self.assertEqual(boundary["removed_fields"], ["source_row_count"])
        self.assertEqual(
            boundary["unique_columns"],
            [
                "pos_ingest_batch_id",
                "order_id",
                "source_order_item_id",
                "source_reversal_order_code",
            ],
        )
        self.assertEqual(
            boundary["metric_fields"],
            [
                "discount_promotion_amount",
                "gross_quantity",
                "gross_sales",
                "net_quantity",
                "net_sales",
                "refund_amount",
                "refund_quantity",
            ],
        )
        self.assertEqual(
            boundary["metric_sign_policy"],
            "ALLOW_NEGATIVE_ZERO_POSITIVE_MIXED_NO_CROSS_FIELD_SIGN_CHECK",
        )
        self.assertEqual(
            boundary["nullability_status"],
            "SOURCE_DERIVED_FIELDS_NOT_NULL_AT_COMPLETE_WATERMARK",
        )
        self.assertEqual(
            boundary["status"], "PARTIAL_EXACT_SOURCE_NULLABILITY_CONFIRMED"
        )
        self.assertEqual(
            boundary["source_order_item_id"],
            {
                "checks": ["btrim(source_order_item_id) <> ''"],
                "data_type": "text",
                "nullable": False,
                "source": "D_itemId",
            },
        )
        self.assertEqual(
            boundary["source_order_status_code"]["allowed_values"],
            ["10", "20", "30"],
        )
        self.assertEqual(
            boundary["source_reversal_order_code"]["allowed_values"],
            ["0", "1", "2", "3"],
        )

    def test_pos_source_probe_closes_nullability_sign_and_item_discount_mapping(self) -> None:
        overlay = json.loads(OVERLAY_PATH.read_text(encoding="utf-8"))
        probe = overlay["pos_source_probe_boundary"]
        self.assertEqual(probe["status"], "AUTHORITATIVE_COMPLETE_WATERMARK")
        self.assertEqual(probe["watermark"], "2026-08-10")
        self.assertEqual(probe["captured_at_utc_start"], "2026-08-11T06:58:19Z")
        self.assertEqual(probe["captured_at_utc_end"], "2026-08-11T06:59:14Z")
        self.assertEqual(
            probe["sales_hour"],
            {
                "digest_sha256": "4776d9fa7a226072ce286059dce408e914743234e1c5c8fad54e64949d258b1b",
                "empty_count": 0,
                "invalid_count": 0,
                "negative_counts": {"discount_amount": 1, "net_sales": 1},
                "null_count": 0,
                "row_count": 2698,
                "stable_row_count": 2698,
                "target_not_null_fields": [
                    "discount_amount",
                    "gross_sales",
                    "net_sales",
                    "order_count",
                    "source_guest_count",
                ],
            },
        )
        self.assertEqual(probe["item_hour"]["row_count"], 83611)
        self.assertEqual(probe["item_hour"]["stable_row_count"], 83611)
        self.assertEqual(
            probe["item_hour"]["digest_sha256"],
            "fe103929ce4d9c88722c0f7c211ec3d28b5e741a8a2783fe8cac00d4df7bd899",
        )
        self.assertEqual(
            probe["item_hour"]["negative_counts"],
            {
                "discount_amount": 406,
                "gross_sales": 8,
                "net_sales": 48,
                "quantity": 9,
            },
        )
        self.assertEqual(
            probe["item_hour"]["discount_source"], "M_Item_SUM_discountProm"
        )
        self.assertEqual(probe["item_hour"]["prior_mapping"], "FORBID_CONSTANT_NULL")
        self.assertEqual(
            probe["rules"],
            [
                "DERIVED_IDS_REMAIN_AUTHORITY_GATED",
                "NO_COALESCE_ZERO",
                "SOURCE_DERIVED_TARGET_FIELDS_NOT_NULL",
            ],
        )

    def test_design_only_catalog_diagram_and_production_are_hard_gates(self) -> None:
        overlay = json.loads(OVERLAY_PATH.read_text(encoding="utf-8"))
        gates = overlay["delivery_gates"]
        self.assertEqual(gates["ddl_status"], "DESIGN_ONLY_NOT_COMPILED")
        self.assertEqual(gates["apply_compatibility"], "NOT_APPLY_COMPATIBLE")
        self.assertEqual(gates["diagram_status"], "GENERATED_FROM_RESOLVED_MODEL")
        self.assertEqual(gates["production_data_gate"], "BLOCKED")
        self.assertEqual(gates["physical_backfill_status"], "PHYSICAL_BACKFILL_NOT_STARTED")
        self.assertFalse(gates["database_writes_allowed"])
        self.assertFalse(gates["source_reads_allowed"])

        compiler = load_compiler()
        unsafe = json.loads(OVERLAY_PATH.read_text(encoding="utf-8"))
        unsafe["delivery_gates"]["database_writes_allowed"] = True
        unsafe_bytes = (
            json.dumps(unsafe, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        ).encode("utf-8")
        with self.assertRaises(compiler.OverlayContractError) as caught:
            compiler.build_package(unsafe_bytes)
        self.assertEqual(caught.exception.code, "unsafe_release_gate")

    def test_view_contract_scope_is_explicit_and_cannot_auto_promote_readiness(self) -> None:
        overlay = json.loads(OVERLAY_PATH.read_text(encoding="utf-8"))
        scope = overlay["view_contract_scope"]
        self.assertEqual(scope["status"], "APPROVED_EXACT_VIEW_CONTRACTS")
        self.assertEqual(scope["affected_view_set_semantics"], "CLOSED_EXACT_26")
        self.assertEqual(scope["physical_sql_view_count"], 0)
        self.assertEqual(
            scope["legacy_myr_fields"],
            [
                "v_cost_card_material_price_current.price_myr_per_base_unit",
                "v_cost_card_product_cost_component.component_cost_myr",
                "v_cost_card_product_cost_component.price_myr_per_base_unit",
                "v_scm_supplier_price_current.normalized_price_myr",
            ],
        )
        self.assertEqual(
            scope["required_invariants"],
            [
                "CLOSED_AFFECTED_VIEW_SET_REQUIRED",
                "CLOSED_FIELD_TYPE_NULLABILITY_LINEAGE_REQUIRED",
                "EXPLICIT_CURRENCY_OUTPUTS_REQUIRED",
                "READINESS_MUST_NOT_AUTO_PROMOTE",
                "SELECT_SPEC_REQUIRED_FOR_PASS",
                "ZERO_PHYSICAL_SQL_VIEWS",
            ],
        )
        self.assertIn("v_cost_card_product_daily_margin", scope["affected_views"])
        self.assertIn("v_finance_margin_reconciliation", scope["affected_views"])
        self.assertIn("v_pos_sales_hour_current", scope["affected_views"])
        self.assertIn("v_pos_item_sales_hour_current", scope["affected_views"])
        self.assertIn("v_pos_item_sales_day", scope["affected_views"])
        self.assertIn("v_pos_order_item_current", scope["affected_views"])
        self.assertIn("v_pos_member_order_item", scope["affected_views"])
        self.assertIn("v_pos_revenue_reconciliation", scope["affected_views"])
        self.assertIn("v_ops_daily_review_current", scope["affected_views"])
        self.assertIn(
            "v_cost_card_material_cost_selection_resolved", scope["affected_views"]
        )
        self.assertIn("v_scm_material_price_normalized", scope["affected_views"])
        self.assertNotIn("v_cost_card_material_price_current", scope["affected_views"])
        self.assertNotIn("v_scm_supplier_price_current", scope["affected_views"])
        self.assertEqual(len(scope["affected_views"]), 26)
        self.assertEqual(
            scope["known_contract_defects"],
            {
                "v_finance_labor_reconciliation": "AFFECTED_DEPENDENCY_EXACT_CONTRACT_PENDING",
                "v_finance_purchase_reconciliation": "AFFECTED_DEPENDENCY_EXACT_CONTRACT_PENDING",
                "v_finance_sales_reconciliation": "BOTH_SIDES_CURRENCY_OUTPUT_REQUIRED_OR_EXPLICIT_BLOCK",
                "v_identity_mapping_gap": "AFFECTED_DEPENDENCY_EXACT_CONTRACT_PENDING",
                "v_ops_daily_review_current": "MANAGER_CURRENCY_OUTPUT_REQUIRED",
                "v_ops_labor_productivity": "AFFECTED_DEPENDENCY_EXACT_CONTRACT_PENDING",
                "v_ops_manager_sales_reconciliation": "BOTH_SIDES_CURRENCY_OUTPUT_REQUIRED_OR_EXPLICIT_BLOCK",
                "v_ops_product_mix_daily": "AFFECTED_DEPENDENCY_EXACT_CONTRACT_PENDING",
                "v_pos_item_sales_day": "EXPLICIT_CURRENCY_OUTPUT_REQUIRED",
                "v_pos_member_daily_summary": "AFFECTED_DEPENDENCY_EXACT_CONTRACT_PENDING",
                "v_pos_revenue_reconciliation": "THREE_SIDE_CURRENCY_MISMATCH_RULE_UNDEFINED",
                "v_scm_purchase_order_reconciliation": "AFFECTED_DEPENDENCY_EXACT_CONTRACT_PENDING",
            },
        )

        contract = scope["contract"]
        self.assertEqual(contract["affected_baseline_field_count"], 281)
        self.assertEqual(contract["affected_resolved_field_count"], 365)
        self.assertEqual(contract["baseline_view_field_count"], 643)
        self.assertEqual(contract["resolved_view_field_count"], 727)
        self.assertEqual(contract["baseline_declared_view_count"], 59)
        self.assertEqual(contract["resolved_declared_view_count"], 59)
        self.assertTrue(
            all(
                view["readiness_status"] != "PASS_SELECT_SPEC"
                and view["readiness_blockers"]
                for view in contract["views"]
            )
        )
        resolved = {view["name"]: view for view in contract["views"]}
        selection_fields = {
            field["name"]: field
            for field in resolved[
                "v_cost_card_material_cost_selection_resolved"
            ]["fields"]
        }
        self.assertTrue(selection_fields["required_rate_type"]["nullable"])
        self.assertTrue(selection_fields["required_rate_basis"]["nullable"])
        self.assertEqual(
            selection_fields["raw_price_amount"]["data_type"], "numeric(24,8)"
        )
        self.assertEqual(
            selection_fields["raw_price_quantity"]["data_type"], "numeric(24,8)"
        )
        self.assertEqual(
            selection_fields["applied_fx_rate"]["data_type"], "numeric(38,18)"
        )
        normalized_fields = {
            field["name"]: field
            for field in resolved["v_scm_material_price_normalized"]["fields"]
        }
        self.assertEqual(
            normalized_fields["raw_price_amount"]["data_type"], "numeric(24,8)"
        )
        self.assertEqual(
            normalized_fields["raw_price_quantity"]["data_type"], "numeric(24,8)"
        )
        self.assertEqual(
            resolved["v_cost_card_material_cost_selection_resolved"][
                "resolved_field_count"
            ],
            26,
        )
        self.assertEqual(
            load_compiler().verify_view_contract_baselines(),
            {
                "affected_baseline_fields": 281,
                "affected_resolved_fields": 365,
                "baseline_fields": 643,
                "baseline_views": 59,
                "resolved_fields": 727,
                "resolved_views": 59,
            },
        )

    def test_closed_view_contract_rejects_field_and_readiness_mutations(self) -> None:
        compiler = load_compiler()
        source = json.loads(OVERLAY_PATH.read_text(encoding="utf-8"))
        views = source["view_contract_scope"]["contract"]["views"]
        selection = next(
            view
            for view in views
            if view["name"] == "v_cost_card_material_cost_selection_resolved"
        )
        basis = next(
            field for field in selection["fields"] if field["name"] == "required_rate_basis"
        )
        basis["nullable"] = False
        mutated = (
            json.dumps(source, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        ).encode()
        with self.assertRaises(compiler.OverlayContractError) as field_error:
            compiler.load_overlay_bytes(mutated)
        self.assertEqual(
            field_error.exception.code, "view_contract_canonical_hash_mismatch"
        )

        promoted = json.loads(OVERLAY_PATH.read_text(encoding="utf-8"))
        promoted["view_contract_scope"]["contract"]["views"][0][
            "readiness_status"
        ] = "PASS_SELECT_SPEC"
        promoted_bytes = (
            json.dumps(promoted, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        ).encode()
        with self.assertRaises(compiler.OverlayContractError) as readiness_error:
            compiler.load_overlay_bytes(promoted_bytes)
        self.assertEqual(readiness_error.exception.code, "view_readiness_auto_promotion")

    def test_global_schema_approval_cannot_hide_incomplete_table_contracts(self) -> None:
        compiler = load_compiler()
        incomplete = json.loads(OVERLAY_PATH.read_text(encoding="utf-8"))
        incomplete["affected_table_contracts"][0]["contract"] = None
        incomplete["affected_table_contracts"][0][
            "exact_schema_status"
        ] = "MISSING_EXACT_SCHEMA"
        incomplete_bytes = (
            json.dumps(incomplete, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        ).encode("utf-8")
        with self.assertRaises(compiler.OverlayContractError) as caught:
            compiler.build_package(incomplete_bytes)
        self.assertEqual(caught.exception.code, "missing_exact_schema")

    def test_schema_approval_rejects_fake_or_empty_contract_sets_before_renderer(self) -> None:
        compiler = load_compiler()
        source = json.loads(OVERLAY_PATH.read_text(encoding="utf-8"))

        fake = json.loads(json.dumps(source))
        fake["affected_table_contracts"] = [
            {
                "baseline_object_name": None,
                "baseline_table_canonical_sha256": None,
                "contract": {},
                "exact_schema_status": "APPROVED_DDL_LEVEL_CONTRACT",
                "object_name": "fake_table",
                "operation": "ADD_TABLE",
                "requested_field_count": 1,
            }
        ]
        fake["exact_schema_status"] = "APPROVED_DDL_LEVEL_CONTRACT"
        fake_bytes = (
            json.dumps(fake, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        ).encode()
        with self.assertRaises(compiler.OverlayContractError) as fake_error:
            compiler.build_package(fake_bytes)
        self.assertEqual(fake_error.exception.code, "schema_contract_identity_mismatch")

        empty = json.loads(json.dumps(source))
        empty["exact_schema_status"] = "APPROVED_DDL_LEVEL_CONTRACT"
        for collection in (
            "affected_table_contracts",
            "future_affected_table_contracts",
        ):
            for item in empty[collection]:
                item["exact_schema_status"] = "APPROVED_DDL_LEVEL_CONTRACT"
                item["requested_field_count"] = 1
                item["contract"] = {}
        empty_bytes = (
            json.dumps(empty, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        ).encode()
        with self.assertRaises(compiler.OverlayContractError) as empty_error:
            compiler.build_package(empty_bytes)
        self.assertEqual(empty_error.exception.code, "invalid_exact_table_contract")

    def test_table_contract_validator_rejects_field_unique_and_count_drift(self) -> None:
        compiler = load_compiler()
        model = json.loads((REVISION_ROOT.parents[1] / "target-model.json").read_text())
        source = next(table for table in model["tables"] if table["name"] == "ops_location")
        summary = compiler.validate_table_contract(
            source, expected_name="ops_location", expected_field_count=16
        )
        self.assertEqual(summary, {"field_count": 16, "primary_key_count": 1})

        missing_field_key = json.loads(json.dumps(source))
        del missing_field_key["fields"][0]["data_type"]
        with self.assertRaises(compiler.OverlayContractError) as missing:
            compiler.validate_table_contract(
                missing_field_key, expected_name="ops_location", expected_field_count=16
            )
        self.assertEqual(missing.exception.code, "invalid_exact_table_contract")

        unknown_unique_field = json.loads(json.dumps(source))
        unknown_unique_field["uniques"].append(["not_a_field"])
        with self.assertRaises(compiler.OverlayContractError) as unique:
            compiler.validate_table_contract(
                unknown_unique_field, expected_name="ops_location", expected_field_count=16
            )
        self.assertEqual(unique.exception.code, "invalid_exact_table_contract")

        with self.assertRaises(compiler.OverlayContractError) as count:
            compiler.validate_table_contract(
                source, expected_name="ops_location", expected_field_count=17
            )
        self.assertEqual(count.exception.code, "invalid_exact_table_contract")

    def test_pure_build_creates_no_generated_bundle(self) -> None:
        compiler = load_compiler()
        generated = REVISION_ROOT / "generated"
        before = (
            None
            if not generated.exists()
            else {
                path.relative_to(generated).as_posix(): path.read_bytes()
                for path in generated.iterdir()
                if path.is_file()
            }
        )
        protected = (COMPILER_PATH, OVERLAY_PATH, Path(__file__).resolve())
        snapshots = {
            path: (path.read_bytes(), path.stat().st_mtime_ns) for path in protected
        }
        compiler.build_package()
        after = (
            None
            if not generated.exists()
            else {
                path.relative_to(generated).as_posix(): path.read_bytes()
                for path in generated.iterdir()
                if path.is_file()
            }
        )
        self.assertEqual(after, before)
        self.assertEqual(
            snapshots,
            {path: (path.read_bytes(), path.stat().st_mtime_ns) for path in protected},
        )

    def test_complete_bundle_is_deterministic_resolved_and_explicitly_design_only(self) -> None:
        compiler = load_compiler()
        first = compiler.build_package()
        second = compiler.build_package()
        self.assertEqual(first, second)
        expected = (
            set(compiler.PAYLOAD_NAMES)
            | {f"{name}.sha256" for name in compiler.PAYLOAD_NAMES}
            | {"manifest.json", "manifest.json.sha256"}
        )
        self.assertEqual(set(first), expected)
        self.assertEqual(first["model-overlay.json"], OVERLAY_PATH.read_bytes())

        resolved = json.loads(first["resolved-target-model.json"])
        self.assertEqual(len(resolved["tables"]), 142)
        self.assertEqual(sum(len(table["fields"]) for table in resolved["tables"]), 1908)
        self.assertEqual(len(resolved["views"]), 59)
        self.assertEqual(sum(len(view["fields"]) for view in resolved["views"]), 727)

        catalog = json.loads(first["resolved-phase1-catalog-contract.json"])
        self.assertEqual(catalog["status"], "MODEL_DERIVED_DESIGN_ONLY")
        self.assertEqual(catalog["apply_compatibility"], "NOT_APPLY_COMPATIBLE")
        self.assertEqual(catalog["counts"], compiler.EXPECTED_RESOLVED_PHASE1_COUNTS)
        self.assertEqual(
            catalog["unique_constraint_subtypes"],
            {"ordinary": 87, "nulls_distinct": 16, "nulls_not_distinct": 10},
        )
        self.assertEqual(catalog["constraint_trigger_catalog_status"], "NOT_COMPILED")
        self.assertEqual(len(catalog["constraint_trigger_contracts"]), 6)
        for trigger in catalog["constraint_trigger_contracts"]:
            self.assertEqual(
                trigger["required_kind"],
                "DEFERRABLE_CONSTRAINT_TRIGGER_REQUIRED_CONTROLLED_FUNCTION_OPTIONAL",
            )
        selection_trigger = next(
            trigger
            for trigger in catalog["constraint_trigger_contracts"]
            if trigger["table"] == "cost_card_material_cost_selection"
        )
        self.assertIn("parent-side eligibility", selection_trigger["invariant"])

        audits = {
            row["table_name"]: row for row in resolved["minimum_grain_audits"]
        }
        self.assertEqual(
            audits["cost_card_recipe_version"]["physical_reason"],
            "每行冻结一个配方代码版本的名称、产出对象、批产量、生效区间和发布治理。",
        )
        self.assertNotIn(
            "售价参考", audits["cost_card_recipe_version"]["physical_reason"]
        )
        self.assertNotIn(
            "reference_sale", audits["cost_card_recipe_version"]["physical_reason"]
        )
        self.assertEqual(
            audits["cost_card_recipe_version"]["action"],
            "R6A1_KEEP_ACTIVE_RECIPE_VERSION; ARCHIVE_LEGACY_REFERENCE_PRICE_OUTSIDE_ACTIVE_MODEL",
        )
        self.assertEqual(
            audits["cost_card_recipe_version"]["claude_fable_5_result"],
            "R6A1_EXACT_CONTRACT_APPROVED_RECIPE_REFERENCE_PRICE_REMOVED",
        )

        def csv_rows(name: str) -> list[dict[str, str]]:
            text = first[name].decode("utf-8-sig")
            return list(csv.DictReader(io.StringIO(text, newline="")))

        self.assertEqual(len(csv_rows("resolved-table-catalog.csv")), 142)
        self.assertEqual(len(csv_rows("resolved-field-dictionary.csv")), 2635)
        self.assertEqual(len(csv_rows("resolved-view-catalog.csv")), 59)
        self.assertIn(b"app_currency", first["resolved-relationship-blueprint.drawio"])
        self.assertIn(b"finance_currency_policy", first["resolved-relationship-blueprint.drawio"])
        self.assertIn(b"https://www.iso.org/standard/64758.html", first["decision-record.md"])

        object_rows = csv_rows("resolved-current-to-target-matrix.csv")
        cost_row = next(row for row in object_rows if row["current_object"] == "cost_card_item_price")
        self.assertEqual(cost_row["disposition"], "R6A1_MAPPING_SUPERSEDED_REVIEW_REQUIRED")
        self.assertEqual(cost_row["target_objects"], "NO_APPROVED_TARGET_INTENT")
        order_row = next(row for row in object_rows if row["current_object"] == "pos_member_order_item")
        self.assertEqual(order_row["disposition"], "RECONCILIATION_ONLY_NO_TARGET_INTENTS")
        recipe_row = next(row for row in object_rows if row["current_object"] == "cost_card_recipe")
        self.assertEqual(
            recipe_row["disposition"],
            "PARTIAL_ACTIVE_ROUTE_WITH_ARCHIVE_ONLY_REFERENCE_PRICE",
        )
        self.assertIn("AUTHENTICATED_S0_OR_MIGRATION_ARCHIVE", recipe_row["target_objects"])
        self.assertNotIn("兼容视图", recipe_row["compatibility_rule"])

        field_rows = csv_rows("resolved-current-field-to-target-matrix.csv")
        for row in field_rows:
            if row["current_object"] in {
                "cost_card_item_price",
                "v_cost_card_price_current_normalized",
            }:
                self.assertEqual(row["target_field_or_disposition"], "NO_APPROVED_TARGET_INTENT")
            if row["current_object"] == "pos_member_order_item":
                self.assertEqual(
                    row["target_field_or_disposition"],
                    "RECONCILIATION_ONLY_NO_LINE_LEVEL_TARGET_INTENT",
                )
        recipe_price = next(
            row for row in field_rows
            if row["current_object"] == "cost_card_recipe"
            and row["current_field"] == "sale_price"
        )
        self.assertEqual(
            recipe_price["field_disposition"],
            "ARCHIVE_ONLY_NO_ACTIVE_TARGET_INTENT",
        )
        self.assertEqual(
            recipe_price["target_field_or_disposition"],
            "AUTHENTICATED_S0_OR_MIGRATION_ARCHIVE_ROUTE_PENDING",
        )
        self.assertNotIn("currency='MYR'", recipe_price["field_migration_rule"])
        self.assertNotIn(
            "PRESERVE_MYR_REFERENCE_PRICE",
            first["resolved-current-field-to-target-matrix.csv"].decode("utf-8-sig"),
        )

    def test_publish_atomically_reseals_existing_bundle_and_then_noops(self) -> None:
        compiler = load_compiler()
        bundle = compiler.build_package()
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary).resolve() / "generated"
            destination.mkdir()
            prior = REVISION_ROOT / "generated"
            for source in prior.iterdir():
                if source.is_file():
                    (destination / source.name).write_bytes(source.read_bytes())
            legacy = destination / "manifest.json"
            legacy_bytes = legacy.read_bytes()
            self.assertNotEqual(legacy_bytes, bundle["manifest.json"])
            legacy_identity = destination.stat().st_ino
            exchange = compiler._atomic_exchange
            observations: list[tuple[bytes, str]] = []

            def observe_exchange(parent_fd, source_name, target_name):
                observations.append(
                    (
                        legacy.read_bytes(),
                        compiler._compare_published_bundle_at(
                            bundle, parent_fd, source_name
                        ),
                    )
                )
                return exchange(parent_fd, source_name, target_name)

            with mock.patch.object(
                compiler, "_atomic_exchange", side_effect=observe_exchange
            ):
                self.assertEqual(
                    compiler.publish_package(bundle, destination), "PUBLISHED"
                )
            self.assertEqual(observations, [(legacy_bytes, "NOOP")])
            self.assertNotEqual(destination.stat().st_ino, legacy_identity)
            self.assertEqual(
                {path.name: path.read_bytes() for path in destination.iterdir()},
                bundle,
            )
            self.assertEqual(compiler.publish_package(bundle, destination), "NOOP")
            self.assertEqual(list(destination.parent.glob(".r6a1-publish-*")), [])

    def test_reseal_rolls_back_staged_in_place_mutation_before_success(self) -> None:
        compiler = load_compiler()
        bundle = compiler.build_package()
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary).resolve() / "generated"
            destination.mkdir()
            (destination / "legacy-manifest").write_bytes(b"old-sealed-bundle")
            old_identity = destination.stat().st_ino
            exchange = compiler._atomic_exchange
            mutated = False

            def mutate_then_exchange(parent_fd, source_name, target_name):
                nonlocal mutated
                if not mutated:
                    mutated = True
                    source_fd = compiler.os.open(
                        source_name,
                        compiler.os.O_RDONLY
                        | getattr(compiler.os, "O_DIRECTORY", 0),
                        dir_fd=parent_fd,
                    )
                    try:
                        descriptor = compiler.os.open(
                            "decision-record.md",
                            compiler.os.O_WRONLY | compiler.os.O_TRUNC,
                            dir_fd=source_fd,
                        )
                        try:
                            compiler.os.write(descriptor, b"mutated")
                        finally:
                            compiler.os.close(descriptor)
                    finally:
                        compiler.os.close(source_fd)
                return exchange(parent_fd, source_name, target_name)

            with mock.patch.object(
                compiler, "_atomic_exchange", side_effect=mutate_then_exchange
            ):
                with self.assertRaises(compiler.OverlayContractError) as caught:
                    compiler.publish_package(bundle, destination)
            self.assertEqual(caught.exception.code, "publish_destination_drift")
            self.assertEqual(destination.stat().st_ino, old_identity)
            self.assertEqual(
                (destination / "legacy-manifest").read_bytes(),
                b"old-sealed-bundle",
            )
            self.assertEqual(list(destination.parent.glob(".r6a1-publish-*")), [])

    def test_publish_rejects_symlink_in_any_parent_component(self) -> None:
        compiler = load_compiler()
        bundle = compiler.build_package()
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary).resolve()
            real = base / "real"
            parent = real / "parent"
            parent.mkdir(parents=True)
            link = base / "link"
            link.symlink_to(real, target_is_directory=True)
            destination = link / "parent" / "generated"
            with self.assertRaises(compiler.OverlayContractError) as caught:
                compiler.publish_package(bundle, destination)
            self.assertEqual(caught.exception.code, "unsafe_publish_parent")
            self.assertFalse((parent / "generated").exists())

    def test_publish_rejects_temporary_collision_and_vanished_race_target(self) -> None:
        compiler = load_compiler()
        bundle = compiler.build_package()
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary).resolve()
            destination = parent / "generated"
            write_file = compiler._write_publish_file
            collision_injected = False

            def collide_with_temporary_file(directory_fd, name, content):
                nonlocal collision_injected
                if not collision_injected:
                    collision_injected = True
                    descriptor = compiler.os.open(
                        name,
                        compiler.os.O_WRONLY
                        | compiler.os.O_CREAT
                        | compiler.os.O_EXCL,
                        0o600,
                        dir_fd=directory_fd,
                    )
                    compiler.os.close(descriptor)
                return write_file(directory_fd, name, content)

            with mock.patch.object(
                compiler,
                "_write_publish_file",
                side_effect=collide_with_temporary_file,
            ):
                with self.assertRaises(compiler.OverlayContractError) as collided:
                    compiler.publish_package(bundle, destination)
            self.assertEqual(
                collided.exception.code, "publish_temporary_collision"
            )
            self.assertFalse(destination.exists())
            self.assertEqual(list(parent.glob(".r6a1-publish-*")), [])

            with mock.patch.object(
                compiler,
                "_atomic_rename_no_replace",
                side_effect=FileExistsError,
            ), mock.patch.object(
                compiler,
                "_compare_published_bundle_at",
                side_effect=["MISSING", "MISSING"],
            ):
                with self.assertRaises(compiler.OverlayContractError) as vanished:
                    compiler.publish_package(bundle, destination)
            self.assertEqual(
                vanished.exception.code, "publish_race_target_missing"
            )
            self.assertFalse(destination.exists())
            self.assertEqual(list(parent.glob(".r6a1-publish-*")), [])

    def test_atomic_no_replace_preserves_racing_empty_target_and_concurrent_noop(self) -> None:
        compiler = load_compiler()
        bundle = compiler.build_package()
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary).resolve() / "generated"
            rename = compiler._atomic_rename_no_replace
            raced_identity = None

            def create_empty_target(parent_fd, source_name, target_name):
                nonlocal raced_identity
                compiler.os.mkdir(target_name, 0o700, dir_fd=parent_fd)
                metadata = compiler.os.stat(
                    target_name, dir_fd=parent_fd, follow_symlinks=False
                )
                raced_identity = (metadata.st_dev, metadata.st_ino)
                return rename(parent_fd, source_name, target_name)

            with mock.patch.object(
                compiler,
                "_atomic_rename_no_replace",
                side_effect=create_empty_target,
            ):
                with self.assertRaises(compiler.OverlayContractError) as race:
                    compiler.publish_package(bundle, destination)
            self.assertEqual(race.exception.code, "publish_destination_drift")
            self.assertTrue(destination.is_dir())
            metadata = destination.stat()
            self.assertEqual((metadata.st_dev, metadata.st_ino), raced_identity)
            self.assertEqual(list(destination.iterdir()), [])

        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary).resolve() / "generated"
            rename = compiler._atomic_rename_no_replace
            barrier = threading.Barrier(2)
            statuses: list[str] = []
            errors: list[BaseException] = []

            def synchronized_rename(parent_fd, source_name, target_name):
                barrier.wait(timeout=10)
                return rename(parent_fd, source_name, target_name)

            def publish() -> None:
                try:
                    statuses.append(compiler.publish_package(bundle, destination))
                except BaseException as error:  # captured for deterministic assertion
                    errors.append(error)

            with mock.patch.object(
                compiler,
                "_atomic_rename_no_replace",
                side_effect=synchronized_rename,
            ):
                threads = [threading.Thread(target=publish) for _ in range(2)]
                for thread in threads:
                    thread.start()
                for thread in threads:
                    thread.join(timeout=20)
            self.assertFalse(any(thread.is_alive() for thread in threads))
            self.assertEqual(errors, [])
            self.assertEqual(sorted(statuses), ["NOOP", "PUBLISHED"])
            self.assertEqual(
                {path.name: path.read_bytes() for path in destination.iterdir()},
                bundle,
            )

    def test_atomic_no_replace_maps_collision_errnos_and_fails_unsupported(self) -> None:
        compiler = load_compiler()

        class FailedRename:
            argtypes = None
            restype = None

            def __init__(self, error_number: int) -> None:
                self.error_number = error_number

            def __call__(self, *_args) -> int:
                compiler.ctypes.set_errno(self.error_number)
                return -1

        class FakeLibrary:
            def __init__(self, error_number: int) -> None:
                self.renameatx_np = FailedRename(error_number)

        for error_number in (compiler.errno.EEXIST, compiler.errno.ENOTEMPTY):
            with self.subTest(error_number=error_number), mock.patch.object(
                compiler.ctypes,
                "CDLL",
                return_value=FakeLibrary(error_number),
            ), mock.patch.object(compiler.sys, "platform", "darwin"):
                with self.assertRaises(FileExistsError):
                    compiler._atomic_rename_no_replace(-1, "source", "target")

        with mock.patch.object(compiler.sys, "platform", "unsupported"):
            with self.assertRaises(compiler.OverlayContractError) as unsupported:
                compiler._atomic_rename_no_replace(-1, "source", "target")
        self.assertEqual(
            unsupported.exception.code, "atomic_no_replace_unsupported"
        )
        with mock.patch.object(compiler.sys, "platform", "unsupported"):
            with self.assertRaises(compiler.OverlayContractError) as exchange:
                compiler._atomic_exchange(-1, "source", "target")
        self.assertEqual(exchange.exception.code, "atomic_exchange_unsupported")

    def test_fd_bound_cleanup_and_compare_reject_name_inode_replacement(self) -> None:
        compiler = load_compiler()
        bundle = compiler.build_package()
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary).resolve()
            parent_fd = compiler._open_directory_no_follow(parent)
            try:
                compiler.os.mkdir("owned", 0o700, dir_fd=parent_fd)
                owned = compiler.os.stat(
                    "owned", dir_fd=parent_fd, follow_symlinks=False
                )
                owned_identity = (owned.st_dev, owned.st_ino)
                compiler.os.rename(
                    "owned", "moved-owned", src_dir_fd=parent_fd, dst_dir_fd=parent_fd
                )
                compiler.os.mkdir("owned", 0o700, dir_fd=parent_fd)
                replacement_fd = compiler.os.open(
                    "owned",
                    compiler.os.O_RDONLY | getattr(compiler.os, "O_DIRECTORY", 0),
                    dir_fd=parent_fd,
                )
                try:
                    compiler._write_publish_file(
                        replacement_fd, "sentinel", b"replacement"
                    )
                finally:
                    compiler.os.close(replacement_fd)
                with self.assertRaises(compiler.OverlayContractError) as cleanup:
                    compiler._cleanup_publish_temporary(
                        parent_fd, "owned", owned_identity
                    )
                self.assertEqual(
                    cleanup.exception.code, "publish_temporary_identity_drift"
                )
                self.assertEqual(
                    (parent / "owned" / "sentinel").read_bytes(), b"replacement"
                )
                self.assertTrue((parent / "moved-owned").is_dir())
            finally:
                compiler.os.close(parent_fd)

        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary).resolve() / "generated"
            self.assertEqual(
                compiler.publish_package(bundle, destination), "PUBLISHED"
            )
            parent_fd = compiler._open_directory_no_follow(destination.parent)
            read_at = compiler._read_regular_file_at
            replaced = False

            def replace_after_open(directory_fd, name):
                nonlocal replaced
                if not replaced:
                    replaced = True
                    compiler.os.rename(
                        "generated",
                        "old-generated",
                        src_dir_fd=parent_fd,
                        dst_dir_fd=parent_fd,
                    )
                    compiler.os.mkdir("generated", 0o700, dir_fd=parent_fd)
                return read_at(directory_fd, name)

            try:
                with mock.patch.object(
                    compiler,
                    "_read_regular_file_at",
                    side_effect=replace_after_open,
                ):
                    with self.assertRaises(compiler.OverlayContractError) as compare:
                        compiler._compare_published_bundle_at(
                            bundle, parent_fd, "generated"
                        )
                self.assertEqual(
                    compare.exception.code,
                    "publish_destination_identity_drift",
                )
                self.assertTrue(destination.is_dir())
                self.assertEqual(list(destination.iterdir()), [])
            finally:
                compiler.os.close(parent_fd)

    def test_build_and_publish_uses_one_snapshot_for_the_whole_operation(self) -> None:
        compiler = load_compiler()
        capture = compiler._capture_input_snapshot
        rename = compiler._atomic_rename_no_replace
        calls = 0
        events: list[str] = []

        def counted_capture(overlay_bytes):
            nonlocal calls
            calls += 1
            return capture(overlay_bytes)

        def ordered_rename(parent_fd, source_name, target_name):
            self.assertEqual(events, [])
            events.append("atomic-publish")
            return rename(parent_fd, source_name, target_name)

        with tempfile.TemporaryDirectory() as temporary, mock.patch.object(
            compiler,
            "_capture_input_snapshot",
            side_effect=counted_capture,
        ), mock.patch.object(
            compiler,
            "_atomic_rename_no_replace",
            side_effect=ordered_rename,
        ):
            bundle, status = compiler.build_and_publish(
                Path(temporary).resolve() / "generated"
            )
        self.assertEqual(status, "PUBLISHED")
        self.assertEqual(calls, 1)
        self.assertEqual(events, ["atomic-publish"])
        self.assertEqual(len(bundle), 26)

    def test_publish_rejects_resealed_unsafe_manifest_and_payload_boundaries(self) -> None:
        compiler = load_compiler()
        bundle = compiler.build_package()
        unsafe_manifest = dict(bundle)
        manifest = json.loads(bundle["manifest.json"])
        manifest["apply_compatibility"] = "APPLY_COMPATIBLE"
        unsafe_manifest["manifest.json"] = compiler._canonical_source_bytes(manifest)
        unsafe_manifest["manifest.json.sha256"] = (
            f"{hashlib.sha256(unsafe_manifest['manifest.json']).hexdigest()}  manifest.json\n"
        ).encode("ascii")
        with self.assertRaises(compiler.OverlayContractError) as manifest_error:
            compiler.publish_package(unsafe_manifest)
        self.assertEqual(
            manifest_error.exception.code, "invalid_sealed_manifest_boundary"
        )

        unsafe_gate = dict(bundle)
        gate = json.loads(bundle["production-data-gate.json"])
        gate["database_writes_allowed"] = True
        unsafe_gate["production-data-gate.json"] = compiler._canonical_source_bytes(gate)
        unsafe_gate["production-data-gate.json.sha256"] = (
            f"{hashlib.sha256(unsafe_gate['production-data-gate.json']).hexdigest()}  "
            "production-data-gate.json\n"
        ).encode("ascii")
        manifest = json.loads(bundle["manifest.json"])
        for row in manifest["outputs"]:
            if row["path"] in {
                "production-data-gate.json",
                "production-data-gate.json.sha256",
            }:
                row["sha256"] = hashlib.sha256(unsafe_gate[row["path"]]).hexdigest()
                row["size_bytes"] = len(unsafe_gate[row["path"]])
        unsafe_gate["manifest.json"] = compiler._canonical_source_bytes(manifest)
        unsafe_gate["manifest.json.sha256"] = (
            f"{hashlib.sha256(unsafe_gate['manifest.json']).hexdigest()}  manifest.json\n"
        ).encode("ascii")
        with self.assertRaises(compiler.OverlayContractError) as gate_error:
            compiler.publish_package(unsafe_gate)
        self.assertEqual(gate_error.exception.code, "invalid_sealed_payload_boundary")

        forged_matrix = dict(bundle)
        matrix_name = "resolved-current-to-target-matrix.csv"
        forged_matrix[matrix_name] += b"FORGED,table,APPLY_NOW,,,,\r\n"
        sidecar_name = f"{matrix_name}.sha256"
        forged_matrix[sidecar_name] = (
            f"{hashlib.sha256(forged_matrix[matrix_name]).hexdigest()}  {matrix_name}\n"
        ).encode("ascii")
        manifest = json.loads(bundle["manifest.json"])
        for row in manifest["outputs"]:
            if row["path"] in {matrix_name, sidecar_name}:
                row["sha256"] = hashlib.sha256(forged_matrix[row["path"]]).hexdigest()
                row["size_bytes"] = len(forged_matrix[row["path"]])
        forged_matrix["manifest.json"] = compiler._canonical_source_bytes(manifest)
        forged_matrix["manifest.json.sha256"] = (
            f"{hashlib.sha256(forged_matrix['manifest.json']).hexdigest()}  manifest.json\n"
        ).encode("ascii")
        with self.assertRaises(compiler.OverlayContractError) as matrix_error:
            compiler._validate_sealed_bundle(forged_matrix)
        self.assertEqual(
            matrix_error.exception.code, "sealed_bundle_provenance_mismatch"
        )

    def test_publish_rejects_resealed_derived_payload_semantic_drift(self) -> None:
        compiler = load_compiler()
        bundle = compiler.build_package()

        catalog_name = "resolved-phase1-catalog-contract.json"
        catalog = json.loads(bundle[catalog_name])
        catalog["active_foreign_keys"][0]["ref_table"] = "forged_table"
        forged_catalog = reseal_payloads(
            compiler,
            bundle,
            {catalog_name: compiler._canonical_source_bytes(catalog)},
        )
        with self.assertRaises(compiler.OverlayContractError) as catalog_error:
            compiler._validate_sealed_bundle(forged_catalog)
        self.assertEqual(
            catalog_error.exception.code, "invalid_sealed_payload_boundary"
        )

        catalog = json.loads(bundle[catalog_name])
        catalog["constraint_trigger_contracts"][0]["catalog_status"] = "COMPILED"
        forged_trigger = reseal_payloads(
            compiler,
            bundle,
            {catalog_name: compiler._canonical_source_bytes(catalog)},
        )
        with self.assertRaises(compiler.OverlayContractError) as trigger_error:
            compiler._validate_sealed_bundle(forged_trigger)
        self.assertEqual(
            trigger_error.exception.code, "invalid_sealed_payload_boundary"
        )

        readiness_name = "resolved-view-readiness.json"
        readiness = json.loads(bundle[readiness_name])
        readiness["views"][0]["field_count"] = 999
        forged_readiness = reseal_payloads(
            compiler,
            bundle,
            {readiness_name: compiler._canonical_source_bytes(readiness)},
        )
        with self.assertRaises(compiler.OverlayContractError) as readiness_error:
            compiler._validate_sealed_bundle(forged_readiness)
        self.assertEqual(
            readiness_error.exception.code, "invalid_sealed_payload_boundary"
        )

        model_name = "resolved-target-model.json"
        gate_name = "production-data-gate.json"
        model = json.loads(bundle[model_name])
        model["tables"][0]["purpose"] += " forged"
        model_bytes = compiler._canonical_source_bytes(model)
        model_sha256 = hashlib.sha256(model_bytes).hexdigest()
        gate = json.loads(bundle[gate_name])
        gate["resolved_model_sha256"] = model_sha256
        catalog = json.loads(bundle[catalog_name])
        catalog["resolved_model_sha256"] = model_sha256
        forged_model = reseal_payloads(
            compiler,
            bundle,
            {
                model_name: model_bytes,
                gate_name: compiler._canonical_source_bytes(gate),
                catalog_name: compiler._canonical_source_bytes(catalog),
            },
        )
        with self.assertRaises(compiler.OverlayContractError) as model_error:
            compiler._validate_sealed_bundle(forged_model)
        self.assertEqual(
            model_error.exception.code, "sealed_bundle_provenance_mismatch"
        )

    def test_resolved_fk_validation_and_contract_hash_pin_reject_mutation(self) -> None:
        compiler = load_compiler()
        resolved = compiler.build_resolved_model()
        assignment = next(
            table for table in resolved["tables"]
            if table["name"] == "finance_currency_assignment"
        )
        currency = next(
            field for field in assignment["fields"] if field["name"] == "currency_code"
        )
        currency["data_type"] = "text"
        with self.assertRaises(compiler.OverlayContractError) as invalid_fk:
            compiler.validate_resolved_model_contracts(resolved)
        self.assertEqual(invalid_fk.exception.code, "invalid_resolved_foreign_key")

        mutated = json.loads(OVERLAY_PATH.read_text(encoding="utf-8"))
        mutated["affected_table_contracts"][0]["contract"]["notes"] += " drift"
        mutated_bytes = (
            json.dumps(mutated, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        ).encode("utf-8")
        with self.assertRaises(compiler.OverlayContractError) as pin:
            compiler.build_package(mutated_bytes)
        self.assertEqual(pin.exception.code, "exact_table_contract_hash_mismatch")

    def test_compiler_has_no_database_network_keychain_or_shell_capability(self) -> None:
        source = COMPILER_PATH.read_text(encoding="utf-8")
        tree = ast.parse(source)
        imported_roots: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported_roots.update(alias.name.split(".")[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported_roots.add(node.module.split(".")[0])
        self.assertTrue(
            imported_roots.isdisjoint(
                {
                    "boto3",
                    "http",
                    "keyring",
                    "psycopg",
                    "requests",
                    "socket",
                    "sqlite3",
                    "subprocess",
                    "urllib",
                }
            )
        )
        lowered = source.lower()
        for forbidden in ("security find-generic-password", "supabase", "postgresql://"):
            self.assertNotIn(forbidden, lowered)

    def test_pure_bundle_sealing_is_closed_deterministic_and_has_no_hash_cycle(self) -> None:
        compiler = load_compiler()
        expected_payload_names = (
            "decision-record.md",
            "model-overlay.json",
            "production-data-gate.json",
            "resolved-current-field-to-target-matrix.csv",
            "resolved-current-to-target-matrix.csv",
            "resolved-field-dictionary.csv",
            "resolved-phase1-catalog-contract.json",
            "resolved-relationship-blueprint.drawio",
            "resolved-table-catalog.csv",
            "resolved-target-model.json",
            "resolved-view-catalog.csv",
            "resolved-view-readiness.json",
        )
        self.assertEqual(compiler.PAYLOAD_NAMES, expected_payload_names)
        payloads = {
            name: f"synthetic:{name}\n".encode("utf-8")
            for name in expected_payload_names
        }
        inputs = [
            {
                "path": "target-model.json",
                "sha256": "0" * 64,
                "size_bytes": 1,
            }
        ]
        first = compiler.seal_payloads(payloads, inputs)
        second = compiler.seal_payloads(dict(reversed(list(payloads.items()))), inputs)
        self.assertEqual(first, second)

        expected_sidecars = {f"{name}.sha256" for name in expected_payload_names}
        self.assertEqual(
            set(first),
            set(expected_payload_names)
            | expected_sidecars
            | {"manifest.json", "manifest.json.sha256"},
        )
        for name in expected_payload_names:
            digest = hashlib.sha256(payloads[name]).hexdigest()
            self.assertEqual(first[f"{name}.sha256"], f"{digest}  {name}\n".encode())

        manifest = json.loads(first["manifest.json"])
        listed_outputs = {entry["path"] for entry in manifest["outputs"]}
        self.assertEqual(
            listed_outputs, set(expected_payload_names) | expected_sidecars
        )
        self.assertNotIn("manifest.json", listed_outputs)
        self.assertNotIn("manifest.json.sha256", listed_outputs)
        manifest_digest = hashlib.sha256(first["manifest.json"]).hexdigest()
        self.assertEqual(
            first["manifest.json.sha256"],
            f"{manifest_digest}  manifest.json\n".encode(),
        )
        self.assertEqual(manifest["apply_compatibility"], "NOT_APPLY_COMPATIBLE")
        self.assertEqual(manifest["release_status"], "DESIGN_ONLY_NOT_COMPILED")
        self.assertEqual(manifest["diagram_status"], "GENERATED_FROM_RESOLVED_MODEL")
        self.assertEqual(
            manifest["input_snapshot_semantics"],
            "ONE_O_NOFOLLOW_DIRFD_BYTE_SNAPSHOT_USED_FOR_VERIFY_RENDER_HASH_AND_PUBLISH_NO_LATER_DISK_READ",
        )
        self.assertEqual(
            manifest["execution_source_binding"],
            "BYTE_CARRYING_COMPILE_EXEC_BOOTSTRAP_COMPILER_BYTES_ARE_ATTESTED_SNAPSHOT;BOOTSTRAP_TRUST_ROOT_REQUIRES_SERIALIZED_WORKTREE_FROM_LAUNCH",
        )

    def test_bundle_sealing_rejects_subclasses_traversal_and_extra_outputs(self) -> None:
        compiler = load_compiler()
        payloads = {name: b"x" for name in compiler.PAYLOAD_NAMES}

        class DictSubclass(dict):
            pass

        with self.assertRaises(compiler.OverlayContractError) as mapping:
            compiler.seal_payloads(DictSubclass(payloads), [])
        self.assertEqual(mapping.exception.code, "exact_dict_required")

        with_extra = dict(payloads)
        with_extra["unexpected.txt"] = b"x"
        with self.assertRaises(compiler.OverlayContractError) as extra:
            compiler.seal_payloads(with_extra, [])
        self.assertEqual(extra.exception.code, "payload_set_mismatch")

        with self.assertRaises(compiler.OverlayContractError) as traversal:
            compiler.seal_payloads(
                payloads,
                [{"path": "../target-model.json", "sha256": "0" * 64, "size_bytes": 1}],
            )
        self.assertEqual(traversal.exception.code, "unsafe_relative_path")

        hostile_bytes = dict(payloads)

        class BytesSubclass(bytes):
            pass

        hostile_bytes[compiler.PAYLOAD_NAMES[0]] = BytesSubclass(b"x")
        with self.assertRaises(compiler.OverlayContractError) as subclass:
            compiler.seal_payloads(hostile_bytes, [])
        self.assertEqual(subclass.exception.code, "bytes_required")


if __name__ == "__main__":
    unittest.main()
