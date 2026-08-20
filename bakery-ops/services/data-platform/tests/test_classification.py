from pathlib import Path

from hotcrush_data_platform.classification import classify_path


def test_payroll_is_sealed() -> None:
    result = classify_path(Path("General/个人财务/工资单/PaySlip May.pdf"))
    assert result.data_class == "C4"
    assert result.bucket_id == "hr-payroll-private"
    assert result.rag_action == "DENY"


def test_resume_requires_review() -> None:
    result = classify_path(Path("HR/CV/candidate-resume.pdf"))
    assert result.data_class == "C3"
    assert result.bucket_id == "hr-recruiting-private"
    assert result.rag_action == "REVIEW_REQUIRED"


def test_internal_handbook_can_auto_ingest() -> None:
    result = classify_path(Path("General/知识库/门店SOP手册.pdf"))
    assert result.data_class == "C1"
    assert result.bucket_id == "kb-internal"
    assert result.rag_action == "AUTO"


def test_unknown_document_is_not_auto_approved() -> None:
    result = classify_path(Path("General/miscellaneous.pdf"))
    assert result.data_class == "C2"
    assert result.bucket_id == "kb-restricted"
    assert result.rag_action == "REVIEW_REQUIRED"


def test_hr_domain_overrides_handbook_keyword() -> None:
    result = classify_path(Path("HR/制度与手册/员工手册.pdf"))
    assert result.data_class == "C2"
    assert result.bucket_id == "kb-restricted"
    assert result.space_id == "10000000-0000-7000-8000-000000000007"
    assert result.rag_action == "REVIEW_REQUIRED"


def test_finance_domain_overrides_sop_keyword() -> None:
    result = classify_path(Path("Finance/SOP/报销操作手册.pdf"))
    assert result.data_class == "C3"
    assert result.bucket_id == "finance-private"
    assert result.rag_action == "DENY"
