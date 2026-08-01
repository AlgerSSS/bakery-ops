#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""HOT CRUSH 明日招聘安排：每天 21:30（Asia/Kuala_Lumpur）读取主 ATS，
向现有业务负责人推送次日面试和试工的姓名、时间、岗位。数据只读，由系统 cron 调度。"""
import json, os, sys, urllib.error, urllib.request
from datetime import datetime, timedelta
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit
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
    sys.exit('config not found (lark_app.json)')

BASE = 'https://open.larksuite.com/open-apis'
APP = CFG['base_app']
ATS_TABLE = 'tbldbmJyzhB87Fq5'
KL = ZoneInfo('Asia/Kuala_Lumpur')

class QuotaExceededError(RuntimeError):
    """本月 Lark 调用量已超限。"""

def http(method, url, token=None, body=None):
    req = urllib.request.Request(url, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + token} if token else {})})
    try:
        lark_budget.record_call("tomorrow_preview")
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

def text(v):
    if v is None: return ''
    if isinstance(v, (int, float)): return v
    if isinstance(v, str): return v.strip()
    if isinstance(v, list):
        return '、'.join(str(x.get('text') or x.get('name') or '') if isinstance(x, dict) else str(x) for x in v).strip('、')
    if isinstance(v, dict): return str(v.get('text') or v.get('name') or '')
    return str(v)

def field_datetime(v):
    if isinstance(v, (int, float)):
        seconds = float(v) / 1000 if abs(float(v)) > 100000000000 else float(v)
        return datetime.fromtimestamp(seconds, KL)
    return None

def md_safe(v):
    return str(v).replace('\r', ' ').replace('\n', ' ').replace('`', 'ˋ').strip()

def resume_link_safe(v):
    if not isinstance(v, str) or any(ord(char) < 32 or ord(char) == 127 for char in v):
        return ''
    parts = urlsplit(v)
    host = (parts.hostname or '').lower()
    if parts.scheme != 'https' or not host.endswith('.larksuite.com') or parts.username or parts.password:
        return ''
    return quote(v, safe=":/?&=%#@+;,$!*'~-._")

def resume_download_url(attachments, token):
    if not isinstance(attachments, list):
        return ''
    for attachment in attachments:
        if not isinstance(attachment, dict) or not attachment.get('tmp_url'):
            continue
        parts = urlsplit(attachment['tmp_url'])
        if parts.scheme != 'https' or \
                parts.netloc.lower() != 'open.larksuite.com' or \
                parts.path != '/open-apis/drive/v1/medias/batch_get_tmp_download_url':
            continue
        url = urlunsplit((parts.scheme, parts.netloc, parts.path,
                          urlencode(parse_qsl(parts.query, keep_blank_values=True)), parts.fragment))
        response = http('GET', url, token)
        if response.get('code') != 0:
            return ''
        downloads = response.get('data', {}).get('tmp_download_urls', [])
        match = next((item for item in downloads
                      if item.get('file_token') == attachment.get('file_token')), None)
        download_url = match.get('tmp_download_url', '') if isinstance(match, dict) else ''
        return resume_link_safe(download_url)
    return ''

def main():
    dry = '--dry-run' in sys.argv
    now = datetime.now(KL)
    tomorrow = (now + timedelta(days=1)).date()
    token = get_token()
    out, pt = [], ''
    while True:
        url = f'{BASE}/bitable/v1/apps/{APP}/tables/{ATS_TABLE}/records?page_size=200' + (f'&page_token={pt}' if pt else '')
        d = http('GET', url, token)['data']
        out += d.get('items', [])
        if not d.get('has_more'): break
        pt = d.get('page_token', '')

    interviews, trials = [], []
    for r in out:
        f = r['fields']
        interview_at = field_datetime(f.get('初面日期'))
        trial_at = field_datetime(f.get('试工日期'))
        if not any(at is not None and at.date() == tomorrow for at in (interview_at, trial_at)):
            continue
        name = text(f.get('候选人姓名')) or '姓名未填写'
        job = text(f.get('关联岗位')) or text(f.get('外部岗位')) or text(f.get('应聘职位编码')) or text(f.get('应聘岗'))
        attachments = f.get('简历附件')
        resume_status = 'missing' if not attachments else 'unavailable'
        resume_url = ''
        if attachments and not dry:
            try:
                resume_url = resume_download_url(attachments, token)
            except Exception as exc:
                print(f"RESUME LINK UNAVAILABLE ({name}): {type(exc).__name__}", file=sys.stderr)
            if resume_url:
                resume_status = 'ready'
        resume = {'resume_url': resume_url, 'resume_status': resume_status}
        if interview_at is not None and interview_at.date() == tomorrow:
            interviews.append({'at': interview_at, 'name': name, 'job': job, **resume})
        if trial_at is not None and trial_at.date() == tomorrow:
            trials.append({'at': trial_at, 'name': name, 'job': job,
                           **resume})

    interviews.sort(key=lambda x: (x['at'], x['name'].casefold()))
    trials.sort(key=lambda x: (x['at'], x['name'].casefold()))

    no_schedule = not interviews and not trials
    result = {
        'target_date': str(tomorrow),
        'source_records': len(out),
        'interview_count': len(interviews),
        'trial_count': len(trials),
        'missing_candidate_name': sum(
            x['name'] == '姓名未填写' for x in interviews + trials
        ),
        'missing_job': sum(not x['job'] for x in interviews + trials),
        'recipients': [r.get('name', '未命名收件人') for r in CFG.get('preview_recipients', [])],
        'status': 'skipped' if no_schedule else 'ready',
        'reason': 'no_schedule' if no_schedule else None,
        'send': False,
    }
    if dry or no_schedule:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    wk = '一二三四五六日'[tomorrow.weekday()]
    def schedule_elements(items, empty_text):
        if not items:
            return [{'tag': 'div', 'text': {'tag': 'lark_md', 'content': empty_text}}]
        rows = []
        for item in items:
            if item.get('resume_url'):
                resume = f"[查看简历]({item['resume_url']})"
            elif item.get('resume_status') == 'missing':
                resume = '简历未上传'
            else:
                resume = '简历暂不可用'
            cells = [
                (2, f"· {item['at'].strftime('%H:%M')}"),
                (5, md_safe(item['name'])),
                (2, md_safe(item['job'] or '岗位未填写')),
                (3, resume),
            ]
            rows.append({
                'tag': 'column_set',
                'flex_mode': 'none',
                'horizontal_spacing': 'default',
                'columns': [
                    {
                        'tag': 'column',
                        'width': 'weighted',
                        'weight': weight,
                        'vertical_align': 'top',
                        'elements': [{'tag': 'div', 'text': {'tag': 'lark_md', 'content': content}}],
                    }
                    for weight, content in cells
                ],
            })
        return rows
    elements = [
        {'tag': 'div', 'text': {'tag': 'lark_md',
         'content': f'📅 **明日面试：{len(interviews)} 人**'}},
        *schedule_elements(interviews, '明日无面试安排'),
        {'tag': 'hr'},
        {'tag': 'div', 'text': {'tag': 'lark_md',
         'content': f'🧪 **明日试工：{len(trials)} 人**'}},
        *schedule_elements(trials, '明日无试工安排'),
    ]
    card = {'config': {'wide_screen_mode': True},
            'header': {'template': 'green', 'title': {'tag': 'plain_text',
                       'content': f'📋 明日面试＋试工 · {tomorrow}（周{wk}）'}},
            'elements': elements}
    targets = CFG.get('preview_recipients', [])
    for target in targets:
        rid = target['open_id']
        resp = http('POST', f'{BASE}/im/v1/messages?receive_id_type=open_id', token,
                    body={'receive_id': rid, 'msg_type': 'interactive',
                          'content': json.dumps(card, ensure_ascii=False)})
        if resp.get('code') != 0:
            print(f"SEND FAILED ({target.get('name', '未命名收件人')}): {resp.get('code')} {resp.get('msg', '')}", file=sys.stderr)
            sys.exit(1)
    print(f'[{now.isoformat()}] tomorrow preview sent to {len(targets)} target(s). interviews={len(interviews)} trials={len(trials)}')

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
