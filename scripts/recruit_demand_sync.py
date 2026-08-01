#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""招聘需求来源守卫。

Lark 原生自动化是招聘需求行的唯一创建者；两个业务提报表是唯一数据源。
本脚本每次运行完成：完整读取、字段结构校验、一对一关系校验、全部业务公式
字段校验，以及职位名称的同值纠偏。它不会自动创建或删除招聘需求行。

调用预算（Lark 按自然月计费，超限返回 99991403）：
- 字段结构（fields）每 SCHEMA_TTL_SECONDS 才校验一次，上一轮不健康时强制校验；
- 只有真正写入过（changed）才重新读取一遍做写后复核，否则本轮读取即复核依据，
  summary 用 reread 字段标明是哪一种；
- tenant_access_token 跨进程磁盘缓存；配额超限后熔断，每小时只放行一次探测。
健康运行的稳定成本因此从 17 次调用降到 4 次。
"""

import argparse
import fcntl
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lark_budget  # noqa: E402  与本脚本同目录


BASE = "https://open.larksuite.com/open-apis"
EXPECTED_APP = "V0kGbEsSQaeOpUsaOtWjd0ePpVb"
STORE_TABLE = "tblDOy5AdsgxlvzC"
FUNCTIONAL_TABLE = "tbl2j9xoC0RMjx6z"
HR_TABLE = "tblf5qNUwZfDg8ut"
ATS_TABLE = "tbldbmJyzhB87Fq5"
SOURCE_LINK_FIELD = "关联招聘需求"
HR_STORE_LINK_FIELD = "业务端填写记录"
HR_FUNCTIONAL_LINK_FIELD = "职能端填写表（总部/驻外）-关联招聘需求"
DEFAULT_CONFIG = "/opt/hotcrush/scripts/lark_app.json"
DEFAULT_STATE = "/opt/hotcrush/scripts/recruit_demand_sync_state.json"
DEFAULT_LOCK = "/run/lock/recruit-demand-sync.lock"
KL = ZoneInfo("Asia/Kuala_Lumpur")
SCHEMA_TTL_SECONDS = 6 * 60 * 60  # 字段结构校验的最长间隔；不健康时无视 TTL 立即重校

# (HR公式字段, 门店字段名, 门店字段ID, 职能字段名, 职能字段ID, 归一化方式)
FORMULA_MAPPINGS = (
    ("对外薪资区间", "对外薪资区间", "fldggtyLN6", "对外薪资区间", "fldTgEJuOB", "text"),
    (
        "紧急程度（业务/职能填）",
        "紧急程度（主表显示）",
        "fld3TpzWqQ",
        "紧急程度（主表显示）",
        "fldwHfCWOk",
        "text",
    ),
    ("业务端实际工作地", "实际工作地（主表显示）", "fldrx4K5Y5", None, None, "text"),
    ("缺编数量", "缺编数量", "flduhjLSir", "缺编数量", "fldmgnDpkl", "number_zero"),
    ("到岗截止", "到岗截止", "fldvo7K40i", "到岗截止", "fldOpBmICH", "date"),
    (
        "在招开关(合并)",
        "在招开关（主表显示）",
        "fld60xDNnM",
        "在招开关（主表显示）",
        "fldxUn585Z",
        "text",
    ),
    ("岗位编码", "岗位编码", "fldl0tvFh4", "岗位编码", "fldd69uCqk", "text"),
    (
        "紧急原因（合并）",
        "紧急原因（选重点/紧急必填）",
        "fldj53Mepb",
        "紧急原因（选重点/紧急必填）",
        "fldpZP0Ars",
        "text",
    ),
)


class ConfigError(RuntimeError):
    pass


class RetryableError(RuntimeError):
    pass


class QuotaExceededError(RetryableError):
    """本月 Lark 调用量已超限：重试没有意义，立即熔断。"""


def text(value):
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, list):
        parts = []
        for item in value:
            if isinstance(item, dict):
                parts.append(str(item.get("text") or item.get("name") or ""))
            else:
                parts.append(str(item))
        return "、".join(part for part in parts if part).strip()
    if isinstance(value, dict):
        return str(value.get("text") or value.get("name") or "").strip()
    return str(value).strip()


def linked_record_ids(value):
    output = set()
    if not isinstance(value, list):
        return output
    for item in value:
        if isinstance(item, str) and item:
            output.add(item)
            continue
        if not isinstance(item, dict):
            continue
        for key in ("record_ids", "link_record_ids"):
            record_ids = item.get(key)
            if isinstance(record_ids, list):
                output.update(record_id for record_id in record_ids if record_id)
            elif isinstance(record_ids, str) and record_ids:
                output.add(record_ids)
        for key in ("record_id", "id"):
            if item.get(key):
                output.add(item[key])
    return output


def normalize_number(value, zero_if_empty=False):
    raw = text(value)
    if not raw:
        return "0" if zero_if_empty else ""
    try:
        number = float(raw)
    except ValueError:
        return raw
    return str(int(number)) if number.is_integer() else str(number)


def normalize_date(value):
    if isinstance(value, list) and len(value) == 1 and isinstance(value[0], dict):
        value = value[0].get("text") or value[0].get("value")
    if value in (None, "", []):
        return ""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return text(value)
    if number > 100_000_000_000:
        return datetime.fromtimestamp(number / 1000, KL).date().isoformat()
    if 10_000 < number < 1_000_000:
        return (date(1899, 12, 30) + timedelta(days=round(number))).isoformat()
    return normalize_number(number)


def normalize(value, mode):
    if mode == "text":
        return text(value)
    if mode == "number_zero":
        return normalize_number(value, zero_if_empty=True)
    if mode == "date":
        return normalize_date(value)
    raise ConfigError(f"unknown normalizer: {mode}")


def _error_payload(error):
    """从 HTTPError 里取出 Lark 的 JSON 响应体（失败则返回空 dict）。"""
    try:
        return json.load(error)
    except (ValueError, OSError):
        return {}


def load_json(path, default=None):
    file_path = Path(path)
    if not file_path.exists():
        if default is not None:
            return default
        raise ConfigError(f"file not found: {path}")
    try:
        return json.loads(file_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ConfigError(f"invalid JSON file: {path}: {error}") from error


def save_state(path, state):
    state_path = Path(path)
    state_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = state_path.with_name(state_path.name + f".tmp.{os.getpid()}")
    temp_path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    os.chmod(temp_path, 0o600)
    os.replace(temp_path, state_path)


class LarkClient:
    def __init__(self, config):
        required = ("app_id", "app_secret", "base_app")
        if any(not config.get(key) for key in required):
            raise ConfigError("Lark config is missing app_id, app_secret, or base_app")
        if config["base_app"] != EXPECTED_APP:
            raise ConfigError("Lark config points to an unexpected Base")
        self.config = config
        self.app = config["base_app"]
        self.token = None

    def request(self, method, url, body=None, use_token=True):
        headers = {"Content-Type": "application/json"}
        if use_token:
            if self.token is None:
                self.refresh_token()
            headers["Authorization"] = "Bearer " + self.token
        data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
        for attempt in range(3):
            request = urllib.request.Request(url, method=method, data=data, headers=headers)
            try:
                lark_budget.record_call("demand_sync")
                with urllib.request.urlopen(request, timeout=30) as response:
                    payload = json.load(response)
            except urllib.error.HTTPError as error:
                # 必须读取响应体：配额超限是 HTTP 429 + body code=99991403，重试只会白烧调用量。
                self._raise_if_quota(_error_payload(error))
                if attempt < 2:
                    time.sleep(1 + attempt)
                    continue
                raise RetryableError(f"Lark HTTP request failed: {error}") from error
            except (urllib.error.URLError, TimeoutError) as error:
                if attempt < 2:
                    time.sleep(1 + attempt)
                    continue
                raise RetryableError(f"Lark HTTP request failed: {error}") from error
            if payload.get("code") == 0:
                return payload
            self._raise_if_quota(payload)
            if payload.get("code") in (99991400, 99991401) and attempt < 2:
                self.token = None
                lark_budget.clear_token()
                self.refresh_token(force=True)
                headers["Authorization"] = "Bearer " + self.token
                continue
            message = payload.get("msg") or f"Lark API code {payload.get('code')}"
            raise RetryableError(message)
        raise RetryableError("Lark request retries exhausted")

    @staticmethod
    def _raise_if_quota(payload):
        if lark_budget.is_quota_error(payload):
            lark_budget.mark_exhausted()
            raise QuotaExceededError(payload.get("msg") or "Lark monthly API quota exceeded")

    def refresh_token(self, force=False):
        if not force:
            cached = lark_budget.cached_token(self.config["app_id"])
            if cached:
                self.token = cached
                return
        payload = self.request(
            "POST",
            f"{BASE}/auth/v3/tenant_access_token/internal",
            body={
                "app_id": self.config["app_id"],
                "app_secret": self.config["app_secret"],
            },
            use_token=False,
        )
        self.token = payload["tenant_access_token"]
        lark_budget.store_token(
            self.config["app_id"], self.token, payload.get("expire", 7200)
        )

    def records(self, table):
        output = []
        page_token = ""
        while True:
            url = f"{BASE}/bitable/v1/apps/{self.app}/tables/{table}/records?page_size=200"
            if page_token:
                url += "&page_token=" + urllib.parse.quote(page_token)
            data = self.request("GET", url)["data"]
            output.extend(data.get("items", []))
            if not data.get("has_more"):
                return output
            next_token = data.get("page_token")
            if not next_token or next_token == page_token:
                raise RetryableError("record pagination did not advance")
            page_token = next_token

    def fields(self, table):
        output = []
        page_token = ""
        while True:
            url = f"{BASE}/bitable/v1/apps/{self.app}/tables/{table}/fields?page_size=100"
            if page_token:
                url += "&page_token=" + urllib.parse.quote(page_token)
            data = self.request("GET", url)["data"]
            output.extend(data.get("items", []))
            if not data.get("has_more"):
                return output
            next_token = data.get("page_token")
            if not next_token or next_token == page_token:
                raise RetryableError("field pagination did not advance")
            page_token = next_token

    def update_hr_name(self, record_id, name):
        self.request(
            "PUT",
            f"{BASE}/bitable/v1/apps/{self.app}/tables/{HR_TABLE}/records/{record_id}",
            body={"fields": {"职位名称": name}},
        )

    def send_guard_alert(self, message):
        receive_id = self.config.get("hr_open_id")
        if not receive_id:
            return False
        self.request(
            "POST",
            f"{BASE}/im/v1/messages?receive_id_type=open_id",
            body={
                "receive_id": receive_id,
                "msg_type": "text",
                "content": json.dumps({"text": message}, ensure_ascii=False),
            },
        )
        return True


def fields_by_name(fields):
    output = {}
    for field in fields:
        name = field.get("field_name")
        if not name or name in output:
            raise ConfigError("duplicate or empty Lark field name")
        output[name] = field
    return output


def validate_schema(schema):
    required_types = {
        STORE_TABLE: {"职位名称": 1, SOURCE_LINK_FIELD: 21},
        FUNCTIONAL_TABLE: {"职位名称": 1, SOURCE_LINK_FIELD: 21},
        HR_TABLE: {
            "职位名称": 1,
            HR_STORE_LINK_FIELD: 21,
            HR_FUNCTIONAL_LINK_FIELD: 21,
        },
        ATS_TABLE: {"关联岗位": 21},
    }
    for table, fields in required_types.items():
        for name, expected_type in fields.items():
            actual = schema[table].get(name)
            if not actual or actual.get("type") != expected_type:
                raise ConfigError(f"unexpected field schema: {table}:{name}")

    for (
        hr_field,
        store_field,
        store_field_id,
        functional_field,
        functional_field_id,
        _mode,
    ) in FORMULA_MAPPINGS:
        definition = schema[HR_TABLE].get(hr_field)
        if not definition or definition.get("type") != 20:
            raise ConfigError(f"missing HR formula field: {hr_field}")
        expression = (definition.get("property") or {}).get("formula_expression") or ""
        if store_field:
            source_definition = schema[STORE_TABLE].get(store_field)
            if (
                not source_definition
                or source_definition.get("field_id") != store_field_id
                or STORE_TABLE not in expression
                or f"$column[{store_field_id}]" not in expression
            ):
                raise ConfigError(f"broken store formula dependency: {hr_field}")
        if functional_field:
            source_definition = schema[FUNCTIONAL_TABLE].get(functional_field)
            if (
                not source_definition
                or source_definition.get("field_id") != functional_field_id
                or FUNCTIONAL_TABLE not in expression
                or f"$column[{functional_field_id}]" not in expression
            ):
                raise ConfigError(f"broken functional formula dependency: {hr_field}")


def load_snapshot(client, verify_schema=True):
    """读取四张表。verify_schema=False 时跳过 4 次 fields 调用（结构在 TTL 内已校验过）。"""
    if verify_schema:
        schema = {
            table: fields_by_name(client.fields(table))
            for table in (STORE_TABLE, FUNCTIONAL_TABLE, HR_TABLE, ATS_TABLE)
        }
        validate_schema(schema)
    records = {
        table: client.records(table)
        for table in (STORE_TABLE, FUNCTIONAL_TABLE, HR_TABLE, ATS_TABLE)
    }
    return records


def source_rows(records):
    output = []
    for kind, table in (("store", STORE_TABLE), ("functional", FUNCTIONAL_TABLE)):
        for row in records[table]:
            fields = row["fields"]
            output.append(
                {
                    "kind": kind,
                    "record_id": row["record_id"],
                    "name": text(fields.get("职位名称")),
                    "links": linked_record_ids(fields.get(SOURCE_LINK_FIELD)),
                    "fields": fields,
                }
            )
    return output


def analyze(records, last_good_counts=None):
    stores = records[STORE_TABLE]
    functional = records[FUNCTIONAL_TABLE]
    hr_rows = records[HR_TABLE]
    ats_rows = records[ATS_TABLE]
    sources = source_rows(records)
    source_by_key = {
        (source["kind"], source["record_id"]): source for source in sources
    }
    hr_by_id = {row["record_id"]: row for row in hr_rows}

    errors = []
    pending = []
    formula_drifts = []
    name_updates = []
    valid_hr_ids = set()

    counts = {
        "store": len(stores),
        "functional": len(functional),
        "source_total": len(sources),
        "hr": len(hr_rows),
        "ats": len(ats_rows),
    }
    if counts["source_total"] == 0 or counts["hr"] == 0:
        errors.append("empty recruitment-demand snapshot")
    if last_good_counts:
        for key in ("store", "functional", "hr", "ats"):
            previous = int(last_good_counts.get(key, 0))
            if previous and counts[key] == 0:
                errors.append("previously nonempty table returned an empty snapshot")
                break
    if counts["source_total"] != counts["hr"]:
        pending.append("business source count does not equal HR demand count")

    forward_refs = defaultdict(list)
    for source in sources:
        if not source["name"]:
            errors.append("business source has an empty job name")
        if len(source["links"]) == 0:
            pending.append("business source is waiting for Lark native automation")
        elif len(source["links"]) > 1:
            errors.append("business source links to multiple HR demands")
        for hr_id in source["links"]:
            forward_refs[hr_id].append(source)
            if hr_id not in hr_by_id:
                errors.append("business source points to a missing HR demand")

    for hr in hr_rows:
        hr_id = hr["record_id"]
        fields = hr["fields"]
        store_links = linked_record_ids(fields.get(HR_STORE_LINK_FIELD))
        functional_links = linked_record_ids(fields.get(HR_FUNCTIONAL_LINK_FIELD))
        reverse_count = len(store_links) + len(functional_links)
        refs = forward_refs.get(hr_id, [])
        if reverse_count == 0 and not refs:
            errors.append("HR demand has no business source")
            continue
        if reverse_count == 0 and refs:
            pending.append("Lark bidirectional relation has not converged")
            continue
        if reverse_count > 1:
            errors.append("HR demand links to multiple business sources")
            continue
        kind = "store" if store_links else "functional"
        source_id = next(iter(store_links or functional_links))
        source = source_by_key.get((kind, source_id))
        if not refs and source is not None and not source["links"]:
            pending.append("Lark bidirectional relation has not converged")
            continue
        if len(refs) != 1:
            errors.append("HR demand forward and reverse relations disagree")
            continue
        if source is None or refs[0] is not source or source["links"] != {hr_id}:
            errors.append("HR demand forward and reverse relations disagree")
            continue

        valid_hr_ids.add(hr_id)
        current_name = text(fields.get("职位名称"))
        if current_name != source["name"]:
            name_updates.append((hr_id, source["name"]))
            continue

        source_side = 1 if source["kind"] == "store" else 2
        for (
            hr_field,
            store_field,
            _store_field_id,
            functional_field,
            _functional_field_id,
            mode,
        ) in FORMULA_MAPPINGS:
            source_field = (store_field, functional_field)[source_side - 1]
            expected = normalize(source["fields"].get(source_field), mode) if source_field else ""
            actual = normalize(fields.get(hr_field), mode)
            if expected != actual:
                formula_drifts.append(hr_field)

    for hr_id, refs in forward_refs.items():
        if hr_id in hr_by_id and len(refs) > 1:
            errors.append("multiple business sources share one HR demand")

    candidate_invalid_targets = 0
    candidate_multi_links = 0
    candidate_unlinked = 0
    candidate_name_mismatches = 0
    for row in ats_rows:
        links = linked_record_ids(row["fields"].get("关联岗位"))
        if not links:
            candidate_unlinked += 1
            continue
        if len(links) > 1:
            candidate_multi_links += 1
            continue
        hr_id = next(iter(links))
        if hr_id not in valid_hr_ids:
            candidate_invalid_targets += 1
            continue
        expected_name = text(row["fields"].get("外部岗位"))
        actual_name = text(hr_by_id[hr_id]["fields"].get("职位名称"))
        if expected_name and expected_name != actual_name:
            candidate_name_mismatches += 1

    if candidate_invalid_targets:
        errors.append("candidate links point to HR demands without a valid business source")
    if candidate_multi_links:
        errors.append("candidate records have multiple HR demand links")
    if candidate_unlinked:
        pending.append("candidate records are waiting for an HR demand link")
    if candidate_name_mismatches:
        pending.append("candidate source job text differs from the linked HR demand")
    if formula_drifts:
        pending.append("business-driven HR formulas have not converged")

    counts.update(
        {
            "valid_hr": len(valid_hr_ids),
            "formula_drifts": len(formula_drifts),
            "candidate_unlinked": candidate_unlinked,
            "candidate_invalid_targets": candidate_invalid_targets,
            "candidate_multi_links": candidate_multi_links,
            "candidate_name_mismatches": candidate_name_mismatches,
        }
    )
    return {
        "counts": counts,
        "errors": list(dict.fromkeys(errors)),
        "pending": list(dict.fromkeys(pending)),
        "name_updates": name_updates,
        "formula_fields_drifted": sorted(set(formula_drifts)),
    }


def is_healthy(plan):
    counts = plan["counts"]
    return (
        not plan["errors"]
        and not plan["pending"]
        and not plan["name_updates"]
        and counts["source_total"] == counts["hr"] == counts["valid_hr"]
    )


def record_outcome(state, healthy, status, counts, now):
    state["last_run"] = now
    state["last_status"] = status
    if healthy:
        state["failure_streak"] = 0
        state["last_good_counts"] = {
            key: counts[key] for key in ("store", "functional", "hr", "ats")
        }
        return False
    state["failure_streak"] = int(state.get("failure_streak", 0)) + 1
    last_alert_at = float(state.get("last_alert_at", 0))
    cooldown_elapsed = not last_alert_at or now - last_alert_at >= 6 * 60 * 60
    return state["failure_streak"] >= 3 and cooldown_elapsed


def maybe_send_alert(client, state, summary, should_alert, now):
    summary["failure_streak"] = int(state.get("failure_streak", 0))
    summary["alert_sent"] = False
    if not should_alert:
        return
    counts = summary["counts"]
    message = (
        "招聘需求对账连续异常。"
        f"当前门店 {counts['store']} + 职能 {counts['functional']} = 来源 {counts['source_total']}，"
        f"招聘需求 {counts['hr']}。请检查 Lark 原生自动化、双向关联或公式字段。"
        "守卫未自动新增或删除招聘需求。"
    )
    try:
        sent = client.send_guard_alert(message)
    except RetryableError:
        summary["alert_error"] = "Lark alert delivery failed"
        return
    summary["alert_sent"] = sent
    if sent:
        state["last_alert_at"] = now


def run(args):
    config = load_json(args.config)
    state = load_json(args.state, default={})
    if not isinstance(state, dict):
        raise ConfigError("state root must be an object")
    client = LarkClient(config)

    # 字段结构变化很少，但公式依赖断裂只有 fields 能发现：TTL 到期或上轮不健康就重校。
    started_at = time.time()
    try:
        schema_checked_at = float(state.get("schema_checked_at", 0) or 0)
    except (TypeError, ValueError):
        schema_checked_at = 0.0
    verify_schema = (
        state.get("last_status") != "healthy"
        or started_at - schema_checked_at >= SCHEMA_TTL_SECONDS
    )

    records = load_snapshot(client, verify_schema=verify_schema)
    if verify_schema:
        state["schema_checked_at"] = started_at
    plan = analyze(records, state.get("last_good_counts"))
    summary = {
        "status": "planned",
        "mode": "apply" if args.apply else "dry-run",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "counts": plan["counts"],
        "actions": {"rename_hr": len(plan["name_updates"])},
        "errors": plan["errors"],
        "pending": plan["pending"],
        "formula_fields_drifted": plan["formula_fields_drifted"],
        "changed": False,
        "post_verified": False,
        "schema_verified": verify_schema,
        "reread": False,
    }

    if not args.apply:
        healthy = is_healthy(plan)
        summary["status"] = "healthy" if healthy else ("blocked" if plan["errors"] else "pending")
        summary["post_verified"] = healthy
        return summary, 0 if healthy else (2 if plan["errors"] else 75)

    if plan["errors"]:
        now = time.time()
        should_alert = record_outcome(state, False, "blocked", plan["counts"], now)
        maybe_send_alert(client, state, summary, should_alert, now)
        save_state(args.state, state)
        summary["status"] = "blocked"
        return summary, 2

    for record_id, name in plan["name_updates"]:
        client.update_hr_name(record_id, name)
    summary["changed"] = bool(plan["name_updates"])

    if summary["changed"]:
        # 只有真写过才需要重读复核；没写过时本轮刚读到的就是最新状态。
        time.sleep(2)
        verified = analyze(
            load_snapshot(client, verify_schema=False), state.get("last_good_counts")
        )
        summary["reread"] = True
    else:
        verified = plan
    healthy = is_healthy(verified)
    summary["post_verified"] = healthy
    summary["verified_counts"] = verified["counts"]
    summary["errors"] = verified["errors"]
    summary["pending"] = verified["pending"]
    summary["formula_fields_drifted"] = verified["formula_fields_drifted"]

    now = time.time()
    status = "healthy" if healthy else ("blocked" if verified["errors"] else "pending")
    should_alert = record_outcome(state, healthy, status, verified["counts"], now)
    summary["counts"] = verified["counts"]
    maybe_send_alert(client, state, summary, should_alert, now)
    save_state(args.state, state)
    summary["status"] = status
    if healthy:
        return summary, 0
    return summary, 2 if verified["errors"] else 75


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default=os.environ.get("LARK_APP_CFG", DEFAULT_CONFIG))
    parser.add_argument("--state", default=DEFAULT_STATE)
    parser.add_argument("--lock", default=DEFAULT_LOCK)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    lock_path = Path(args.lock)
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        lock_handle = lock_path.open("a+")
        fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print(json.dumps({"status": "skipped", "reason": "lock_busy"}, sort_keys=True))
        return 75
    except OSError as error:
        print(json.dumps({"status": "failed", "error": f"lock failure: {error}"}), file=sys.stderr)
        return 78

    try:
        if lark_budget.quota_blocked():
            print(json.dumps({"status": "skipped", "reason": "lark_quota_exhausted"}, sort_keys=True))
            return 75
        lark_budget.mark_probe()
        summary, exit_code = run(args)
        lark_budget.mark_recovered()
    except ConfigError as error:
        print(json.dumps({"status": "failed", "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 78
    except QuotaExceededError as error:
        print(json.dumps({"status": "quota_exhausted", "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 75
    except RetryableError as error:
        print(json.dumps({"status": "retryable", "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 75
    except Exception as error:
        print(json.dumps({"status": "failed", "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1
    finally:
        fcntl.flock(lock_handle.fileno(), fcntl.LOCK_UN)
        lock_handle.close()
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
