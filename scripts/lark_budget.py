#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Lark 调用预算共享设施：tenant_access_token 磁盘缓存 + 月度配额熔断 + 月度用量计量。

四个招聘脚本共用。目的有三个：
1. 每个进程不再各自换取 token（token 有效期约 2 小时，跨进程复用）；
2. Lark 返回 99991403（本月调用量超限）后停止无意义的轮询和重试，
   只保留每小时一次探测，配额恢复后自动解除熔断；
3. 按自然月累计实际调用次数（2026-08-01 新增）。在此之前只有熔断没有计量——
   配额烧到哪完全看不见，只能等撞墙。现在能提前知道。

状态文件与脚本同目录，权限 600。
"""

import fcntl
import json
import os
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

_HERE = Path(__file__).resolve().parent
TOKEN_CACHE = Path(os.environ.get("LARK_TOKEN_CACHE") or _HERE / ".lark_token_cache.json")
QUOTA_STATE = Path(os.environ.get("LARK_QUOTA_STATE") or _HERE / ".lark_quota_state.json")
# 用量必须独立存放：mark_recovered() 会删掉 QUOTA_STATE，跟它放一起会在配额恢复时被一并抹掉。
USAGE_STATE = Path(os.environ.get("LARK_USAGE_STATE") or _HERE / ".lark_usage_state.json")
USAGE_LOCK = Path(str(USAGE_STATE) + ".lock")

QUOTA_EXCEEDED_CODE = 99991403
PROBE_INTERVAL_SECONDS = 3600  # 熔断后每小时放行一次探测

MONTHLY_QUOTA = int(os.environ.get("LARK_MONTHLY_QUOTA") or 10000)
WARN_RATIO = float(os.environ.get("LARK_WARN_RATIO") or 0.8)
KL = ZoneInfo("Asia/Kuala_Lumpur")


def _read(path):
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _write(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(path.name + f".tmp.{os.getpid()}")
    temp_path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    os.chmod(temp_path, 0o600)
    os.replace(temp_path, path)


def _unlink(path):
    try:
        Path(path).unlink()
    except OSError:
        pass


# ---------- tenant_access_token 磁盘缓存 ----------

def cached_token(app_id):
    """返回仍在有效期内的 token，否则 None。"""
    data = _read(TOKEN_CACHE)
    if data.get("app_id") != app_id:
        return None
    try:
        expires_at = float(data.get("expires_at", 0))
    except (TypeError, ValueError):
        return None
    token = data.get("token")
    if token and expires_at > time.time():
        return token
    return None


def store_token(app_id, token, expire_seconds=7200):
    try:
        expire_seconds = float(expire_seconds)
    except (TypeError, ValueError):
        expire_seconds = 7200.0
    _write(
        TOKEN_CACHE,
        {
            "app_id": app_id,
            "token": token,
            "expires_at": time.time() + max(expire_seconds - 300, 60),
        },
    )


def clear_token():
    _unlink(TOKEN_CACHE)


# ---------- 月度配额熔断 ----------

def is_quota_error(payload):
    return isinstance(payload, dict) and payload.get("code") == QUOTA_EXCEEDED_CODE


def quota_blocked():
    """True = 已确认本月超限且探测窗口未到，本次运行应直接跳过。"""
    state = _read(QUOTA_STATE)
    exhausted_at = state.get("exhausted_at")
    if not exhausted_at:
        return False
    try:
        last_probe = float(state.get("last_probe_at", exhausted_at))
    except (TypeError, ValueError):
        return False
    return time.time() - last_probe < PROBE_INTERVAL_SECONDS


def mark_probe():
    """记录本次是熔断期内的探测运行，避免同一小时反复探测。"""
    state = _read(QUOTA_STATE)
    if state.get("exhausted_at"):
        state["last_probe_at"] = time.time()
        _write(QUOTA_STATE, state)


def mark_exhausted():
    now = time.time()
    state = _read(QUOTA_STATE)
    state.setdefault("exhausted_at", now)
    state["last_probe_at"] = now
    state["last_seen_at"] = now
    _write(QUOTA_STATE, state)


def mark_recovered():
    """任一次调用成功即解除熔断（配额按自然月重置，无需硬编码日期）。"""
    if QUOTA_STATE.exists():
        _unlink(QUOTA_STATE)


# ---------- 月度用量计量 ----------

def _month_key():
    """自然月键。用 KL 时区判断——配额边界和 Lark 的实际重置时刻可能差几小时，
    但这个计数是用来提前告警的，不是对账用的，几小时偏差无影响。"""
    return datetime.now(KL).strftime("%Y-%m")


def record_call(source="unknown", n=1):
    """记录 n 次实际发出的 Lark API 调用。

    调用点应放在 urlopen 正前方，**重试也要计**——每次重试都是真实消耗配额的请求。

    跨进程用 fcntl 排他锁做读-改-写：四个脚本可能并发（funnel 整点、demand 每 3 小时
    在 09/12/15/18/21 与 funnel 撞点），无锁会丢计数。

    返回 (count, quota, crossed_warn)。crossed_warn 只在**本次跨过阈值那一下**为 True，
    调用方据此只告警一次，而不是之后每次都喊。

    计量失败绝不能影响正常业务：任何异常都吞掉并返回 (None, quota, False)。
    """
    try:
        month = _month_key()
        USAGE_LOCK.parent.mkdir(parents=True, exist_ok=True)
        with open(USAGE_LOCK, "a+") as lock:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
            try:
                state = _read(USAGE_STATE)
                if state.get("month") != month:
                    # 自然月翻页：归档上月总数供事后对比，计数清零
                    previous = (
                        {"month": state.get("month"), "count": int(state.get("count", 0)),
                         "by_source": state.get("by_source", {})}
                        if state.get("month") else None
                    )
                    state = {"month": month, "count": 0, "by_source": {}, "previous": previous}
                before = int(state.get("count", 0))
                state["count"] = before + n
                by_source = state.setdefault("by_source", {})
                by_source[source] = int(by_source.get(source, 0)) + n
                state["updated_at"] = time.time()
                _write(USAGE_STATE, state)
            finally:
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)
        threshold = int(MONTHLY_QUOTA * WARN_RATIO)
        return state["count"], MONTHLY_QUOTA, before < threshold <= state["count"]
    except Exception:
        return None, MONTHLY_QUOTA, False


def usage_snapshot():
    """返回 {month, count, quota, ratio, by_source, previous}，供脚本汇报或人工查看。"""
    state = _read(USAGE_STATE)
    month = _month_key()
    count = int(state.get("count", 0)) if state.get("month") == month else 0
    return {
        "month": month,
        "count": count,
        "quota": MONTHLY_QUOTA,
        "ratio": round(count / MONTHLY_QUOTA, 4) if MONTHLY_QUOTA else None,
        "by_source": state.get("by_source", {}) if state.get("month") == month else {},
        "previous": state.get("previous"),
    }


if __name__ == "__main__":
    # 人工查看：python3 lark_budget.py
    print(json.dumps(usage_snapshot(), ensure_ascii=False, indent=2))
