"""Declarative types for the HOT CRUSH Core V1 review model.

The model is deliberately executable metadata, not executable migration SQL.
Every generated table and field must carry enough explanation for a business
owner and a developer to agree on its meaning before implementation begins.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable
import uuid


@dataclass(frozen=True)
class Field:
    name: str
    zh_name: str
    data_type: str
    description: str
    purpose: str
    nullable: bool = False
    default: str | None = None
    pk: bool = False
    fk: str | None = None
    fk_activation: str = "WITH_TABLE"
    unique: bool = False
    sensitive: str = "none"
    example: str = ""
    checks: tuple[str, ...] = ()
    notes: str = ""


@dataclass(frozen=True)
class TableForeignKey:
    """A table-level FK for relationships that require more than one column.

    Field.fk remains the compact declaration for a single-column FK.  This
    type is deliberately separate so generators cannot silently flatten or
    partially enforce a composite identity relationship.
    """

    columns: tuple[str, ...]
    ref_table: str
    ref_columns: tuple[str, ...]
    fk_activation: str = "WITH_TABLE"
    match_type: str = "SIMPLE"


@dataclass(frozen=True)
class Table:
    name: str
    zh_name: str
    domain: str
    purpose: str
    grain: str
    writer: str
    readers: tuple[str, ...]
    source: str
    lifecycle: str
    mutation_policy: str
    fields: tuple[Field, ...]
    foreign_keys: tuple[TableForeignKey, ...] = ()
    uniques: tuple[tuple[str, ...], ...] = ()
    nulls_not_distinct_uniques: tuple[tuple[str, ...], ...] = ()
    nulls_distinct_uniques: tuple[tuple[str, ...], ...] = ()
    exclusions: tuple[str, ...] = ()
    checks: tuple[str, ...] = ()
    retention: str = "业务存续期内保留；归档规则在实施前确认"
    notes: str = ""


@dataclass(frozen=True)
class View:
    name: str
    zh_name: str
    domain: str
    purpose: str
    grain: str
    readers: tuple[str, ...]
    fields: tuple[Field, ...]
    lineage: tuple[str, ...]
    readiness_status: str
    readiness_blockers: tuple[str, ...]
    grain_key: tuple[str, ...] | None
    notes: str = "只读分析接口，不允许作为业务事实写入口。"


def F(
    name: str,
    zh_name: str,
    data_type: str,
    description: str,
    purpose: str,
    *,
    nullable: bool = False,
    default: str | None = None,
    pk: bool = False,
    fk: str | None = None,
    fk_activation: str = "WITH_TABLE",
    unique: bool = False,
    sensitive: str = "none",
    example: str = "",
    checks: Iterable[str] = (),
    notes: str = "",
) -> Field:
    return Field(
        name=name,
        zh_name=zh_name,
        data_type=data_type,
        description=description,
        purpose=purpose,
        nullable=nullable,
        default=default,
        pk=pk,
        fk=fk,
        fk_activation=fk_activation,
        unique=unique,
        sensitive=sensitive,
        example=example,
        checks=tuple(checks),
        notes=notes,
    )


def ID(
    name: str,
    zh_name: str,
    description: str,
    *,
    fk: str | None = None,
    fk_activation: str = "WITH_TABLE",
    nullable: bool = False,
) -> Field:
    example_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"https://hotcrush.example/field/{name}"))
    return F(
        name,
        zh_name,
        "uuid",
        description,
        "作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。",
        pk=fk is None,
        fk=fk,
        fk_activation=fk_activation,
        nullable=nullable,
        default="gen_random_uuid()" if fk is None else None,
        example=example_id,
    )


def CREATED_AT() -> Field:
    return F(
        "created_at",
        "创建时间",
        "timestamptz",
        "该行首次写入数据库的绝对时间。",
        "用于审计写入先后、排查延迟；不能代替业务发生时间。",
        default="now()",
        example="2026-08-09T10:30:00+08:00",
    )


def UPDATED_AT() -> Field:
    return F(
        "updated_at",
        "最后更新时间",
        "timestamptz",
        "该行最后一次被允许修改的绝对时间。",
        "用于增量同步和并发检查；事实发生时间仍应使用专门字段。",
        default="now()",
        example="2026-08-09T11:05:00+08:00",
    )


def CREATED_BY(nullable: bool = True) -> Field:
    return F(
        "created_by_user_id",
        "创建账号",
        "uuid",
        "触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。",
        "区分谁确认了业务事实与哪个服务实际执行 SQL。",
        fk="app_user.user_id",
        nullable=nullable,
        sensitive="internal",
        example="018f7f12-7c40-7dc1-a2ac-4a7924c60b21",
    )


def standard_fields(mode: str) -> tuple[Field, ...]:
    if mode == "immutable":
        return (CREATED_AT(),)
    if mode == "manual":
        return (CREATED_BY(), CREATED_AT(), UPDATED_AT())
    if mode == "mutable":
        return (CREATED_AT(), UPDATED_AT())
    if mode == "none":
        return ()
    raise ValueError(f"unknown standard field mode: {mode}")


def T(
    name: str,
    zh_name: str,
    domain: str,
    purpose: str,
    grain: str,
    writer: str,
    readers: Iterable[str],
    source: str,
    lifecycle: str,
    fields: Iterable[Field],
    *,
    standard: str = "mutable",
    mutation_policy: str | None = None,
    foreign_keys: Iterable[TableForeignKey] = (),
    uniques: Iterable[Iterable[str]] = (),
    nulls_not_distinct_uniques: Iterable[Iterable[str]] = (),
    nulls_distinct_uniques: Iterable[Iterable[str]] = (),
    exclusions: Iterable[str] = (),
    checks: Iterable[str] = (),
    retention: str = "业务存续期内保留；归档规则在实施前确认",
    notes: str = "",
) -> Table:
    if mutation_policy is None:
        mutation_policy = {
            "immutable": "APPEND_ONLY",
            "manual": "CONTROLLED_UPDATE",
            "mutable": "CONTROLLED_UPDATE",
            "none": "APPEND_ONLY",
        }[standard]
    return Table(
        name=name,
        zh_name=zh_name,
        domain=domain,
        purpose=purpose,
        grain=grain,
        writer=writer,
        readers=tuple(readers),
        source=source,
        lifecycle=lifecycle,
        mutation_policy=mutation_policy,
        fields=tuple(fields) + standard_fields(standard),
        foreign_keys=tuple(foreign_keys),
        uniques=tuple(tuple(item) for item in uniques),
        nulls_not_distinct_uniques=tuple(tuple(item) for item in nulls_not_distinct_uniques),
        nulls_distinct_uniques=tuple(tuple(item) for item in nulls_distinct_uniques),
        exclusions=tuple(exclusions),
        checks=tuple(checks),
        retention=retention,
        notes=notes,
    )


def V(
    name: str,
    zh_name: str,
    domain: str,
    purpose: str,
    grain: str,
    readers: Iterable[str],
    fields: Iterable[Field],
    lineage: Iterable[str],
    *,
    readiness_status: str,
    readiness_blockers: Iterable[str],
    grain_key: Iterable[str] | None,
    notes: str = "只读分析接口，不允许作为业务事实写入口。",
) -> View:
    return View(
        name=name,
        zh_name=zh_name,
        domain=domain,
        purpose=purpose,
        grain=grain,
        readers=tuple(readers),
        fields=tuple(fields),
        lineage=tuple(lineage),
        readiness_status=readiness_status,
        readiness_blockers=tuple(readiness_blockers),
        grain_key=None if grain_key is None else tuple(grain_key),
        notes=notes,
    )


ALL_READERS = ("BakeryOps", "RES/POS", "财务网站", "HBTI", "分析/BI")
