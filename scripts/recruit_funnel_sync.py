#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""漏斗统计表自动同步：定时从候选人库（ATS）实时重算各阶段人数并回写，
让仪表盘漏斗图保持最新（Lark 跨表公式在 API 下不可可靠计算，故用脚本同步）。
数据流单向：ATS -> 漏斗统计表。由系统 cron 调度。

调用预算：token 走跨进程磁盘缓存；配额超限（99991403）立即熔断不重试。
稳定成本为每次 2 次读取（无变化时不产生写入）。"""
import json, os, sys, time, urllib.error, urllib.request
from datetime import datetime
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
import lark_budget  # noqa: E402  与本脚本同目录

for _p in (os.environ.get('LARK_APP_CFG'), os.path.join(_HERE, 'lark_app.json')):
    if _p and os.path.exists(_p):
        with open(_p, encoding='utf-8') as _f:
            CFG = json.load(_f)
        break
else:
    sys.exit('config not found')

BASE = 'https://open.larksuite.com/open-apis'
APP = CFG['base_app']
ATS = 'tbldbmJyzhB87Fq5'
FUNNEL = 'tblqzx2J4Zwa5lLP'
STAGES = ['联系约面', '初面', '试工', '试工后面试', '已发offer', '待入职', '已入职']  # 已淘汰不计入累计
KL = ZoneInfo('Asia/Kuala_Lumpur')

class LarkApiError(RuntimeError):
    pass


class QuotaExceededError(RuntimeError):
    """本月 Lark 调用量已超限：重试没有意义，立即熔断。

    刻意不继承 LarkApiError —— http() 的重试分支捕获 LarkApiError，
    继承会让配额错误被重新吞掉重试。"""


def _raise_if_quota(payload):
    if lark_budget.is_quota_error(payload):
        lark_budget.mark_exhausted()
        raise QuotaExceededError(payload.get('msg') or 'Lark monthly API quota exceeded')

def _lark_error(payload, prefix=''):
    code = payload.get('code') if isinstance(payload, dict) else None
    msg = payload.get('msg') if isinstance(payload, dict) else None
    detail = f'Lark code={code} msg={msg}' if code is not None else 'invalid Lark response'
    return LarkApiError(f'{prefix}{detail}')

def http(method, url, token=None, body=None):
    last_error = None
    for attempt in range(3):
        req = urllib.request.Request(url, method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + token} if token else {})})
        try:
            lark_budget.record_call("funnel_sync")
            with urllib.request.urlopen(req, timeout=30) as r:
                payload = json.load(r)
            if isinstance(payload, dict) and payload.get('code') not in (None, 0):
                _raise_if_quota(payload)
                raise _lark_error(payload)
            return payload
        except urllib.error.HTTPError as e:
            try:
                payload = json.load(e)
            except (ValueError, OSError):
                payload = {}
            _raise_if_quota(payload)
            last_error = _lark_error(payload, f'HTTP {e.code}: ')
        except (urllib.error.URLError, TimeoutError, LarkApiError) as e:
            last_error = e
        if attempt < 2:
            delay = attempt + 1
            print(f'  request failed ({attempt + 1}/3): {last_error}; retry in {delay}s', file=sys.stderr)
            time.sleep(delay)
    raise RuntimeError(str(last_error)) from last_error

def text(v):
    if isinstance(v, list):
        return ''.join(str(x.get('text') or x.get('name') or '') if isinstance(x, dict) else str(x) for x in v)
    return str(v or '')

def same_count(value, expected):
    if value is None or isinstance(value, bool):
        return False
    try:
        number = Decimal(str(value).strip())
    except (InvalidOperation, ValueError):
        return False
    return number.is_finite() and number == number.to_integral_value() and int(number) == expected

def get_token():
    cached = lark_budget.cached_token(CFG['app_id'])
    if cached:
        return cached
    d = http('POST', f'{BASE}/auth/v3/tenant_access_token/internal',
             body={'app_id': CFG['app_id'], 'app_secret': CFG['app_secret']})
    tok = d['tenant_access_token']
    lark_budget.store_token(CFG['app_id'], tok, d.get('expire', 7200))
    return tok

def main():
    dry = '--dry-run' in sys.argv
    tok = get_token()
    out, pt = [], ''
    while True:
        u = f'{BASE}/bitable/v1/apps/{APP}/tables/{ATS}/records?page_size=200' + (f'&page_token={pt}' if pt else '')
        dd = http('GET', u, tok)['data']
        out += dd.get('items', [])
        if not dd.get('has_more'): break
        pt = dd.get('page_token', '')
    cur = {s: 0 for s in STAGES}
    for r in out:
        st = text(r['fields'].get('当前阶段'))
        if st in cur: cur[st] += 1
    cum = {}
    for i, s in enumerate(STAGES):
        cum[s] = sum(cur[t] for t in STAGES[i:])

    rows = http('GET', f'{BASE}/bitable/v1/apps/{APP}/tables/{FUNNEL}/records?page_size=50', tok)['data']['items']
    updated = 0
    for r in rows:
        stage = text(r['fields'].get('阶段'))
        if stage not in cur: continue
        old_cum, old_cur = r['fields'].get('累计人数'), r['fields'].get('当期人数')
        new = {}
        if not same_count(old_cum, cum[stage]): new['累计人数'] = cum[stage]
        if not same_count(old_cur, cur[stage]): new['当期人数'] = cur[stage]
        if new:
            print(f'  {stage}: 累计 {old_cum}->{cum[stage]} 当期 {old_cur}->{cur[stage]}')
            if not dry:
                http('PUT', f"{BASE}/bitable/v1/apps/{APP}/tables/{FUNNEL}/records/{r['record_id']}", tok, {'fields': new})
            updated += 1
    print(f'[{datetime.now(KL).isoformat()}] funnel sync: {updated} row(s) updated. cur={cur}')

if __name__ == '__main__':
    if lark_budget.quota_blocked():
        print(json.dumps({'status': 'skipped', 'reason': 'lark_quota_exhausted'}))
        raise SystemExit(75)
    lark_budget.mark_probe()
    try:
        main()
    except QuotaExceededError as error:
        print(json.dumps({'status': 'quota_exhausted', 'error': str(error)}, ensure_ascii=False),
              file=sys.stderr)
        raise SystemExit(75) from None
    lark_budget.mark_recovered()
