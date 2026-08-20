from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path

SPACE_IDS = {
    "kb-internal": "10000000-0000-7000-8000-000000000001",
    "hr-recruiting-private": "10000000-0000-7000-8000-000000000002",
    "hr-payroll-private": "10000000-0000-7000-8000-000000000003",
    "finance-private": "10000000-0000-7000-8000-000000000004",
    "legal-private": "10000000-0000-7000-8000-000000000005",
    "kb-restricted": "10000000-0000-7000-8000-000000000006",
    "hr-policy-restricted": "10000000-0000-7000-8000-000000000007",
}

BUCKETS = {
    "kb-internal": "kb-internal",
    "hr-recruiting-private": "hr-recruiting-private",
    "hr-payroll-private": "hr-payroll-private",
    "finance-private": "finance-private",
    "legal-private": "legal-private",
    "kb-restricted": "kb-restricted",
    "hr-policy-restricted": "kb-restricted",
}


@dataclass(frozen=True)
class Classification:
    data_class: str
    bucket_id: str
    space_id: str
    document_type: str
    rag_action: str
    reason: str

    def to_dict(self) -> dict[str, str]:
        return asdict(self)


def classify_path(path: Path) -> Classification:
    value = str(path).casefold()
    top_level = path.parts[0].casefold() if path.parts else ""

    payroll = ("payroll", "payslip", "工资", "薪资", "薪酬", "wage", "bank statement")
    identity = ("身份证", "passport", "护照", "个人财务")
    recruiting = ("resume", "cv", "简历", "candidate", "候选人", "offer", "面试")
    finance = ("receipt", "invoice", "报销", "发票", "财务", "备用金", "claims")
    legal = ("合同", "contract", "协议", "授权", "legal")
    internal = ("sop", "手册", "制度", "培训", "brand", "品牌", "知识库", "skill")

    if any(keyword in value for keyword in payroll + identity):
        space = "hr-payroll-private"
        return Classification("C4", BUCKETS[space], SPACE_IDS[space], "PAYROLL", "DENY", "payroll/identity keyword")
    if any(keyword in value for keyword in recruiting):
        space = "hr-recruiting-private"
        return Classification("C3", BUCKETS[space], SPACE_IDS[space], "RESUME", "REVIEW_REQUIRED", "recruiting PII keyword")
    if top_level in ("finance", "财务") or any(keyword in value for keyword in finance):
        space = "finance-private"
        return Classification("C3", BUCKETS[space], SPACE_IDS[space], "FINANCE_RECORD", "DENY", "finance domain/record keyword")
    if top_level in ("legal", "法务") or any(keyword in value for keyword in legal):
        space = "legal-private"
        return Classification("C3", BUCKETS[space], SPACE_IDS[space], "CONTRACT", "REVIEW_REQUIRED", "legal domain/keyword")
    if top_level in ("hr", "人力资源", "人事"):
        space = "hr-policy-restricted"
        return Classification("C2", BUCKETS[space], SPACE_IDS[space], "HR_POLICY", "REVIEW_REQUIRED", "HR domain requires review")
    if any(keyword in value for keyword in internal):
        space = "kb-internal"
        return Classification("C1", BUCKETS[space], SPACE_IDS[space], "SOP", "AUTO", "internal knowledge keyword")

    space = "kb-restricted"
    return Classification("C2", BUCKETS[space], SPACE_IDS[space], "OTHER", "REVIEW_REQUIRED", "no confident rule")
