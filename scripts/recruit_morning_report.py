#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""HOT CRUSH 招聘早报：每天 09:00（Asia/Kuala_Lumpur）读取 Lark 多维表格，
生成完整招聘早报卡片并发给 HR。由 launchd 调度，也可手动运行。
数据只读，只发一条消息。"""
import json, os, sys, time, urllib.request, urllib.error
from datetime import datetime, timedelta, date
from zoneinfo import ZoneInfo

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
import lark_budget  # noqa: E402  与本脚本同目录

for _p in (os.environ.get('LARK_APP_CFG'), os.path.join(_HERE, 'lark_app.json'),
           '/Users/weiliangshao/.config/recruit-report/lark_app.json'):
    if _p and os.path.exists(_p):
        CFG = json.load(open(_p)); break
else:
    sys.exit('config not found (lark_app.json)')
BASE = 'https://open.larksuite.com/open-apis'
APP = CFG['base_app']
HR_TABLE = 'tblf5qNUwZfDg8ut'      # 招聘需求表（HR）
ATS_TABLE = 'tbldbmJyzhB87Fq5'     # 候选人库（ATS）
DASH_URL = f'https://fjpks7iroa9l.jp.larksuite.com/base/{APP}?table=blkMgj51Z8TyVFj4'
VIEW_REVIEW = f'https://fjpks7iroa9l.jp.larksuite.com/base/{APP}?table={HR_TABLE}&view=vewibyRaHx'
VIEW_OVERDUE = f'https://fjpks7iroa9l.jp.larksuite.com/base/{APP}?table={HR_TABLE}&view=vew8q4NU0c'
ATS_URL = f'https://fjpks7iroa9l.jp.larksuite.com/base/{APP}?table={ATS_TABLE}'
KL = ZoneInfo('Asia/Kuala_Lumpur')
EPOCH = date(1899, 12, 30)  # Lark 表格序列日起点

class QuotaExceededError(RuntimeError):
    """本月 Lark 调用量已超限。"""

def http(method, url, token=None, body=None):
    req = urllib.request.Request(url, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + token} if token else {})})
    try:
        lark_budget.record_call("morning_report")
        with urllib.request.urlopen(req, timeout=30) as r:
            payload = json.load(r)
    except urllib.error.HTTPError as e:
        try:
            payload = json.load(e)
        except (ValueError, OSError):
            payload = {}
        if lark_budget.is_quota_error(payload):
            lark_budget.mark_exhausted()
            raise QuotaExceededError(payload.get('msg') or 'Lark monthly API quota exceeded') from None
        raise
    if lark_budget.is_quota_error(payload):
        lark_budget.mark_exhausted()
        raise QuotaExceededError(payload.get('msg') or 'Lark monthly API quota exceeded')
    return payload

def get_token():
    cached = lark_budget.cached_token(CFG['app_id'])
    if cached:
        return cached
    d = http('POST', f'{BASE}/auth/v3/tenant_access_token/internal',
             body={'app_id': CFG['app_id'], 'app_secret': CFG['app_secret']})
    tok = d['tenant_access_token']
    lark_budget.store_token(CFG['app_id'], tok, d.get('expire', 7200))
    return tok

def records(token, tid):
    out, pt = [], ''
    while True:
        url = f'{BASE}/bitable/v1/apps/{APP}/tables/{tid}/records?page_size=200' + (f'&page_token={pt}' if pt else '')
        d = http('GET', url, token)['data']
        out += d.get('items', [])
        if not d.get('has_more'): return out
        pt = d.get('page_token', '')

def text(v):
    """把 Lark 字段值拍平成字符串"""
    if v is None: return ''
    if isinstance(v, (int, float)): return v
    if isinstance(v, str): return v.strip()
    if isinstance(v, list):
        parts = []
        for x in v:
            if isinstance(x, dict): parts.append(str(x.get('text') or x.get('name') or ''))
            else: parts.append(str(x))
        return '、'.join(p for p in parts if p)
    if isinstance(v, dict): return str(v.get('text') or v.get('name') or '')
    return str(v)

def serial_to_date(n):
    try: return EPOCH + timedelta(days=round(float(n)))  # 四舍五入修正公式时区偏移（.6667=吉隆坡零点）
    except Exception: return None

def ms_to_date(n):
    try: return datetime.fromtimestamp(float(n) / 1000, KL).date()
    except Exception: return None

def field_date(v):
    """日期字段可能是 ms 时间戳或序列日"""
    if v is None: return None
    if isinstance(v, (int, float)):
        return ms_to_date(v) if v > 100000000000 else serial_to_date(v)
    return None

def main():
    dry = '--dry-run' in sys.argv   # 只打印不发
    now = datetime.now(KL)
    today, yesterday = now.date(), (now - timedelta(days=1)).date()
    token = get_token()
    hr = records(token, HR_TABLE)
    ats = records(token, ATS_TABLE)

    # ---------- HR 需求表指标 ----------
    review, overdue, p0, urgent, key, due7, noowner, incomplete, stale7, new_yest = [], [], [], [], [], [], [], [], [], []
    gap_total, recruiting = 0, 0
    for r in hr:
        f = r['fields']
        name = text(f.get('职位名称'))
        org = text(f.get('归属组织（主表显示）'))
        active = '在招' in text(f.get('在招开关(合并)'))
        ddl = field_date(f.get('到岗截止'))
        gap = text(f.get('缺编数量'))
        label = f'{name}（{org}·缺 {gap or "?"}）'
        if '待审核' in text(f.get('HR审核状态')): review.append(label)
        if active:
            recruiting += 1
            try: gap_total += float(gap or 0)
            except Exception: pass
            if text(f.get('优先级')).startswith('P0'): p0.append(label)
            urg = text(f.get('紧急程度（业务/职能填）'))
            if '紧急' in urg: urgent.append(label)
            if '重点' in urg: key.append(label)
            if not text(f.get('负责人/带教')): noowner.append(label)
            inc = text(f.get('数据完整性'))
            if inc and inc != '完整': incomplete.append(label)
            if ddl:
                if ddl < today: overdue.append(f'{label}·已超 {(today - ddl).days} 天')
                elif (ddl - today).days <= 7: due7.append(f'{label}·{(ddl - today).days} 天后')
            lm = f.get('最近推进时间')
            lmd = ms_to_date(lm) if lm else None
            if lmd and (today - lmd).days >= 7: stale7.append(label)
        cd = f.get('需求创建时间')
        if cd and ms_to_date(cd) == yesterday: new_yest.append(label)

    # ---------- ATS 指标 ----------
    funnel_order = ['联系约面', '初面', '试工', '试工后面试', '已发offer', '待入职', '已入职', '已淘汰']
    funnel = {k: 0 for k in funnel_order}
    interview_today, trial_today, feedback_due = [], [], []
    for r in ats:
        f = r['fields']
        st = text(f.get('当前阶段'))
        if st in funnel: funnel[st] += 1
        cname = text(f.get('候选人姓名'))
        job = text(f.get('应聘职位编码')) or text(f.get('关联岗位'))
        if field_date(f.get('初面日期')) == today: interview_today.append(f'{cname}（{job}）')
        if field_date(f.get('试工日期')) == today: trial_today.append(f'{cname}（{job}）')
        fdd = field_date(f.get('反馈截止时间'))
        if fdd and fdd <= today and st in ('初面', '试工', '试工后面试'):
            feedback_due.append(f'{cname}（{job}·{st}）')

    # ---------- 卡片 ----------
    def sec(title): return {'tag': 'div', 'text': {'tag': 'lark_md', 'content': f'**{title}**'}}
    def line(t): return {'tag': 'div', 'text': {'tag': 'lark_md', 'content': t}}
    def lst(items, n=None):
        if not items: return '无'
        return '\n'.join('· ' + i for i in items)
    hr_line = lambda: None
    wk = '一二三四五六日'[today.weekday()]
    elements = [
        sec(f'一、今日必办（{today} 周{wk}）'),
        line(f'🔴 **待 HR 审核：{len(review)}**\n{lst(review)}'),
        line(f'🔴 **已逾期岗位：{len(overdue)}**\n{lst(overdue)}'),
        line(f'🟠 **P0：{len(p0)}　紧急：{len(urgent)}　重点：{len(key)}**\n{lst(list(dict.fromkeys(p0 + urgent + key)))}'),
        line(f'🟡 **7 日内到期：{len(due7)}**　昨日新增：{len(new_yest)}' + (f'\n{lst(due7)}' if due7 else '')),
        {'tag': 'hr'},
        sec('二、今日安排'),
        line(f'📅 **今日面试：{len(interview_today)}**\n{lst(interview_today)}'),
        line(f'🧪 **今日试工：{len(trial_today)}**\n{lst(trial_today)}'),
        line(f'⏰ **反馈到期未交：{len(feedback_due)}**\n{lst(feedback_due)}'),
        {'tag': 'hr'},
        sec('三、漏斗快照'),
        line(' → '.join(f'{k} {v}' for k, v in funnel.items() if k != '已淘汰') + f'（淘汰 {funnel["已淘汰"]}）'),
        line(f'缺编总数 **{int(gap_total)}** · 在招岗位 **{recruiting}**'),
        {'tag': 'hr'},
        sec('四、数据质量'),
        line(f'🧹 资料不完整：{len(incomplete)}　缺负责人：{len(noowner)}　7 天无推进：{len(stale7)}'),
        {'tag': 'hr'},
        sec('五、快捷入口'),
        {'tag': 'action', 'actions': [
            {'tag': 'button', 'text': {'tag': 'plain_text', 'content': '📊 招聘仪表盘'}, 'url': DASH_URL, 'type': 'primary'},
            {'tag': 'button', 'text': {'tag': 'plain_text', 'content': f'去审核 ({len(review)})'}, 'url': VIEW_REVIEW},
            {'tag': 'button', 'text': {'tag': 'plain_text', 'content': f'处理逾期 ({len(overdue)})'}, 'url': VIEW_OVERDUE},
            {'tag': 'button', 'text': {'tag': 'plain_text', 'content': '候选人库'}, 'url': ATS_URL},
        ]},
        {'tag': 'note', 'elements': [{'tag': 'plain_text', 'content': '由招聘早报脚本自动生成 · 09:00（吉隆坡）'}]},
    ]
    card = {'config': {'wide_screen_mode': True},
            'header': {'template': 'blue', 'title': {'tag': 'plain_text',
                       'content': f'🌅 HOT CRUSH 招聘早报 · {today}（周{wk}）'}},
            'elements': elements}

    if dry:
        print(json.dumps(card, ensure_ascii=False, indent=1))
        return
    # 收件人列表：open_id 以个人私聊发送，chat_id 以群发送
    targets = [('open_id', CFG['hr_open_id'])] if CFG.get('hr_open_id') else []
    for r in CFG.get('recipients', []):
        if r.get('open_id'): targets.append(('open_id', r['open_id']))
        if r.get('chat_id'): targets.append(('chat_id', r['chat_id']))
    # hr_open_id 也可能同时出现在 recipients 里，去重
    seen, uniq = set(), []
    for t in targets:
        if t not in seen: seen.add(t); uniq.append(t)
    for kind, rid in uniq:
        resp = http('POST', f'{BASE}/im/v1/messages?receive_id_type={kind}', token,
                    body={'receive_id': rid, 'msg_type': 'interactive',
                          'content': json.dumps(card, ensure_ascii=False)})
        if resp.get('code') != 0:
            print(f'SEND FAILED ({kind}={rid}):', json.dumps(resp, ensure_ascii=False)[:500], file=sys.stderr)
            sys.exit(1)
    print(f'[{now.isoformat()}] morning report sent to {len(uniq)} target(s). review={len(review)} overdue={len(overdue)} p0={len(p0)}')

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
