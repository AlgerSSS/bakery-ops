-- Finance vertical slice: monthly financial facts, finance-side daily revenue and cost cards.
--
-- Grain decisions, derived from the legacy production schema rather than assumed:
--   * finance_pl_metrics / finance_expense / finance_labor_detail / finance_material /
--     finance_targets / finance_cashflow are all "one signed amount for a month, a store and
--     a set of dimensions". They are modelled as one fact table with a domain discriminator
--     instead of six near-identical tables.
--   * The legacy natural key is NOT unique: finance_expense legitimately holds two separate
--     entries for (2026-03, 物料费, 日常物料, 银行账户采买). The legacy row id is therefore part
--     of the key so distinct entries are never silently collapsed into one.
--   * finance_revenue_daily is empty in legacy production. The table is still created so the
--     contract exists, but no data is implied by its presence.
--
-- Explicitly NOT migrated here: app_user / app_session / app_permission and the rest of the
-- finance site's own auth tables. Those are the finance site's session and credential store,
-- not finance facts; copying them into R6 would duplicate a credential boundary for no
-- analytical gain.

-- Extend the source -> pipeline allowlist. Without this, a FINANCE_MONTHLY batch cannot
-- schedule its own loader, and the existing FINANCE_EXCEL/finance_import pair stays untouched
-- so the legacy finance import path keeps working exactly as before.
create or replace function private.is_allowed_pipeline(
  p_source_system text,
  p_pipeline_key text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_source_system in ('RES_POS_DAILY', 'LEGACY_POS_EXPORT')
      then p_pipeline_key = 'pos_daily_sales'
    when p_source_system = 'RES_POS_MEMBER'
      then p_pipeline_key = 'pos_member_snapshot'
    when p_source_system = 'RES_POS_MEMBER_TXN'
      then p_pipeline_key = 'pos_member_transaction'
    when p_source_system = 'RES_POS'
      then p_pipeline_key in ('pos_daily_sales', 'pos_member_snapshot', 'pos_member_transaction')
    when p_source_system = 'JOBSTREET_APPLICANT'
      then p_pipeline_key = 'hr_application_import'
    when p_source_system = 'FINANCE_EXCEL'
      then p_pipeline_key = 'finance_import'
    when p_source_system = 'FINANCE_MONTHLY'
      then p_pipeline_key = 'finance_monthly'
    when p_source_system = 'FINANCE_COST_CARD'
      then p_pipeline_key = 'finance_cost_card'
    else false
  end;
$$;

create table public.fin_month_fact (
  source_batch_id uuid not null references public.ops_raw_batch(batch_id) on delete restrict,
  domain text not null,
  source_row_key text not null,
  period_month text not null,
  store_id text not null,
  store_scope text not null default 'STORE',
  store_name_source text,
  major text,
  sub text,
  item text,
  category text,
  org text,
  source text,
  amount numeric(18, 2) not null,
  raw_record jsonb not null,
  loaded_at timestamptz not null default now(),
  primary key (source_batch_id, domain, source_row_key),
  constraint fin_month_fact_domain_ck check (
    domain in ('PL_METRIC', 'EXPENSE', 'LABOR', 'MATERIAL', 'TARGET', 'CASHFLOW')
  ),
  constraint fin_month_fact_month_ck check (period_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  constraint fin_month_fact_store_ck check (btrim(store_id) <> ''),
  constraint fin_month_fact_scope_ck check (store_scope in ('STORE', 'GROUP')),
  constraint fin_month_fact_row_key_ck check (btrim(source_row_key) <> ''),
  constraint fin_month_fact_raw_record_ck check (jsonb_typeof(raw_record) = 'object')
);

comment on table public.fin_month_fact is
  'One versioned monthly finance amount per source batch, domain and legacy row key; written only by the finance_monthly processing RPC, never by POS or RAG pipelines.';
comment on column public.fin_month_fact.store_scope is
  'STORE for a single outlet, GROUP for an aggregate row. finance_targets carries both a 全部 group target and an identical per-store target; without this discriminator, summing the domain would double every target.';
comment on column public.fin_month_fact.source_row_key is
  'Stable identity of the legacy row (its id where the legacy table has one, otherwise its dimension tuple). Keeps two genuinely distinct entries that share a dimension tuple from collapsing into one fact.';

create index fin_month_fact_current_idx
  on public.fin_month_fact (store_scope, store_id, period_month desc, domain, source_batch_id);

create table public.fin_revenue_day (
  source_batch_id uuid not null references public.ops_raw_batch(batch_id) on delete restrict,
  business_date date not null,
  store_id text not null,
  store_name_source text,
  revenue numeric(18, 2) not null,
  gross_sales numeric(18, 2),
  total_discount numeric(18, 2),
  discount_rate numeric(9, 4),
  import_source text,
  raw_record jsonb not null,
  loaded_at timestamptz not null default now(),
  primary key (source_batch_id, business_date, store_id),
  constraint fin_revenue_day_store_ck check (btrim(store_id) <> ''),
  constraint fin_revenue_day_rate_ck check (discount_rate is null or discount_rate between 0 and 1),
  constraint fin_revenue_day_raw_record_ck check (jsonb_typeof(raw_record) = 'object')
);

comment on table public.fin_revenue_day is
  'Finance-side daily revenue as reported by the finance import path. Distinct from pos_sales_day: that one is the RES POS fact. Divergence between the two is a real finding, so they are never merged into one table.';

create index fin_revenue_day_current_idx
  on public.fin_revenue_day (store_id, business_date desc, source_batch_id);

create table public.fin_cost_item (
  source_batch_id uuid not null references public.ops_raw_batch(batch_id) on delete restrict,
  legacy_item_id bigint not null,
  name text not null,
  item_type text,
  base_unit text,
  status text,
  source_ref text,
  legacy_created_at timestamptz,
  legacy_updated_at timestamptz,
  raw_record jsonb not null,
  loaded_at timestamptz not null default now(),
  primary key (source_batch_id, legacy_item_id),
  constraint fin_cost_item_name_ck check (btrim(name) <> ''),
  constraint fin_cost_item_raw_record_ck check (jsonb_typeof(raw_record) = 'object')
);

comment on table public.fin_cost_item is
  'Cost-card material and product master, versioned by source batch. legacy_item_id preserves the production id so recipes and prices keep referring to the same material after migration.';

create table public.fin_cost_item_price (
  source_batch_id uuid not null references public.ops_raw_batch(batch_id) on delete restrict,
  legacy_price_id bigint not null,
  legacy_item_id bigint not null,
  supplier text,
  unit_price numeric(18, 4),
  currency text,
  price_unit text,
  price_quantity numeric(18, 4),
  normalized_price_myr numeric(18, 4),
  normalized_unit text,
  effective_from date,
  effective_to date,
  source text,
  verification_state text,
  verification_note text,
  raw_record jsonb not null,
  loaded_at timestamptz not null default now(),
  primary key (source_batch_id, legacy_price_id),
  constraint fin_cost_item_price_window_ck check (
    effective_to is null or effective_from is null or effective_to >= effective_from
  ),
  constraint fin_cost_item_price_raw_record_ck check (jsonb_typeof(raw_record) = 'object')
);

comment on table public.fin_cost_item_price is
  'Time-windowed purchase prices per cost-card material. normalized_price_myr is carried over verbatim; it is not recomputed here, so a wrong normalization in production stays visible instead of being silently corrected.';

create index fin_cost_item_price_item_idx
  on public.fin_cost_item_price (legacy_item_id, effective_from desc, source_batch_id);

create table public.fin_cost_recipe (
  source_batch_id uuid not null references public.ops_raw_batch(batch_id) on delete restrict,
  legacy_recipe_id bigint not null,
  legacy_item_id bigint not null,
  version integer,
  status text,
  batch_yield numeric(18, 4),
  batch_unit text,
  sale_price numeric(18, 2),
  effective_from date,
  effective_to date,
  notes text,
  raw_record jsonb not null,
  loaded_at timestamptz not null default now(),
  primary key (source_batch_id, legacy_recipe_id),
  constraint fin_cost_recipe_window_ck check (
    effective_to is null or effective_from is null or effective_to >= effective_from
  ),
  constraint fin_cost_recipe_raw_record_ck check (jsonb_typeof(raw_record) = 'object')
);

comment on table public.fin_cost_recipe is
  'Versioned cost-card recipe headers. status carries the production publish state; a draft recipe is kept rather than dropped so cost history stays reconstructible.';

create index fin_cost_recipe_item_idx
  on public.fin_cost_recipe (legacy_item_id, version desc, source_batch_id);

create table public.fin_cost_recipe_item (
  source_batch_id uuid not null references public.ops_raw_batch(batch_id) on delete restrict,
  legacy_recipe_item_id bigint not null,
  legacy_recipe_id bigint not null,
  component_item_id bigint not null,
  quantity numeric(18, 6),
  unit text,
  net_yield numeric(18, 6),
  loss_rate numeric(9, 6),
  seq integer,
  notes text,
  raw_record jsonb not null,
  loaded_at timestamptz not null default now(),
  primary key (source_batch_id, legacy_recipe_item_id),
  constraint fin_cost_recipe_item_raw_record_ck check (jsonb_typeof(raw_record) = 'object')
);

comment on table public.fin_cost_recipe_item is
  'Recipe component lines. loss_rate and net_yield are carried over unchanged so a cost recomputed in R6 can be compared against the production number instead of replacing it.';

create index fin_cost_recipe_item_recipe_idx
  on public.fin_cost_recipe_item (legacy_recipe_id, seq, source_batch_id);

alter table public.fin_month_fact enable row level security;
alter table public.fin_revenue_day enable row level security;
alter table public.fin_cost_item enable row level security;
alter table public.fin_cost_item_price enable row level security;
alter table public.fin_cost_recipe enable row level security;
alter table public.fin_cost_recipe_item enable row level security;

-- Current views: same "latest completed READY batch wins" rule the POS domain already uses.

create or replace view public.v_fin_month_fact_current
with (security_invoker = true)
as
select distinct on (fact.domain, fact.source_row_key)
  fact.source_batch_id,
  fact.domain,
  fact.source_row_key,
  fact.period_month,
  fact.store_id,
  fact.store_scope,
  fact.store_name_source,
  fact.major,
  fact.sub,
  fact.item,
  fact.category,
  fact.org,
  fact.source,
  fact.amount,
  fact.loaded_at
from public.fin_month_fact as fact
join public.ops_raw_batch as batch on batch.batch_id = fact.source_batch_id
where batch.status = 'READY'
order by fact.domain, fact.source_row_key,
  batch.completed_at desc, batch.started_at desc, fact.source_batch_id desc;

comment on view public.v_fin_month_fact_current is
  'Current accepted monthly finance facts selected by latest completed immutable Raw batch.';

create or replace view public.v_fin_revenue_day_current
with (security_invoker = true)
as
select distinct on (fact.store_id, fact.business_date)
  fact.source_batch_id,
  fact.business_date,
  fact.store_id,
  fact.store_name_source,
  fact.revenue,
  fact.gross_sales,
  fact.total_discount,
  fact.discount_rate,
  fact.import_source,
  fact.loaded_at
from public.fin_revenue_day as fact
join public.ops_raw_batch as batch on batch.batch_id = fact.source_batch_id
where batch.status = 'READY'
order by fact.store_id, fact.business_date,
  batch.completed_at desc, batch.started_at desc, fact.source_batch_id desc;

comment on view public.v_fin_revenue_day_current is
  'Current accepted finance-side daily revenue selected by latest completed immutable Raw batch.';

create or replace view public.v_fin_cost_item_current
with (security_invoker = true)
as
select distinct on (fact.legacy_item_id)
  fact.source_batch_id, fact.legacy_item_id, fact.name, fact.item_type, fact.base_unit,
  fact.status, fact.source_ref, fact.legacy_created_at, fact.legacy_updated_at, fact.loaded_at
from public.fin_cost_item as fact
join public.ops_raw_batch as batch on batch.batch_id = fact.source_batch_id
where batch.status = 'READY'
order by fact.legacy_item_id, batch.completed_at desc, batch.started_at desc, fact.source_batch_id desc;

comment on view public.v_fin_cost_item_current is
  'Current accepted cost-card materials selected by latest completed immutable Raw batch.';

create or replace view public.v_fin_cost_item_price_current
with (security_invoker = true)
as
select distinct on (fact.legacy_price_id)
  fact.source_batch_id, fact.legacy_price_id, fact.legacy_item_id, fact.supplier,
  fact.unit_price, fact.currency, fact.price_unit, fact.price_quantity,
  fact.normalized_price_myr, fact.normalized_unit, fact.effective_from, fact.effective_to,
  fact.source, fact.verification_state, fact.verification_note, fact.loaded_at
from public.fin_cost_item_price as fact
join public.ops_raw_batch as batch on batch.batch_id = fact.source_batch_id
where batch.status = 'READY'
order by fact.legacy_price_id, batch.completed_at desc, batch.started_at desc, fact.source_batch_id desc;

comment on view public.v_fin_cost_item_price_current is
  'Current accepted cost-card material prices selected by latest completed immutable Raw batch.';

create or replace view public.v_fin_cost_recipe_current
with (security_invoker = true)
as
select distinct on (fact.legacy_recipe_id)
  fact.source_batch_id, fact.legacy_recipe_id, fact.legacy_item_id, fact.version, fact.status,
  fact.batch_yield, fact.batch_unit, fact.sale_price, fact.effective_from, fact.effective_to,
  fact.notes, fact.loaded_at
from public.fin_cost_recipe as fact
join public.ops_raw_batch as batch on batch.batch_id = fact.source_batch_id
where batch.status = 'READY'
order by fact.legacy_recipe_id, batch.completed_at desc, batch.started_at desc, fact.source_batch_id desc;

comment on view public.v_fin_cost_recipe_current is
  'Current accepted cost-card recipe headers selected by latest completed immutable Raw batch.';

create or replace view public.v_fin_cost_recipe_item_current
with (security_invoker = true)
as
select distinct on (fact.legacy_recipe_item_id)
  fact.source_batch_id, fact.legacy_recipe_item_id, fact.legacy_recipe_id,
  fact.component_item_id, fact.quantity, fact.unit, fact.net_yield, fact.loss_rate,
  fact.seq, fact.notes, fact.loaded_at
from public.fin_cost_recipe_item as fact
join public.ops_raw_batch as batch on batch.batch_id = fact.source_batch_id
where batch.status = 'READY'
order by fact.legacy_recipe_item_id, batch.completed_at desc, batch.started_at desc, fact.source_batch_id desc;

comment on view public.v_fin_cost_recipe_item_current is
  'Current accepted cost-card recipe lines selected by latest completed immutable Raw batch.';

-- Controlled write path. Same lease/pipeline/batch guards the POS loader uses; a worker that
-- does not currently hold the run cannot write a finance fact.

create or replace function public.ops_load_finance_monthly(
  p_processing_run_id bigint,
  p_worker_id text,
  p_month_rows jsonb,
  p_revenue_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '30s'
as $$
declare
  v_run public.ops_processing_run%rowtype;
  v_batch public.ops_raw_batch%rowtype;
  v_month_count bigint;
  v_revenue_count bigint;
begin
  select * into strict v_run
  from public.ops_processing_run
  where processing_run_id = p_processing_run_id
  for update;

  if v_run.status <> 'RUNNING' or v_run.claimed_by <> p_worker_id or v_run.lease_until <= now() then
    raise exception 'processing run is not actively leased by this worker' using errcode = '55000';
  end if;
  if v_run.pipeline_key <> 'finance_monthly' then
    raise exception 'processing run pipeline is not finance_monthly' using errcode = '22023';
  end if;
  if jsonb_typeof(p_month_rows) <> 'array' or jsonb_typeof(p_revenue_rows) <> 'array' then
    raise exception 'finance row payloads must be arrays' using errcode = '22023';
  end if;

  select * into strict v_batch from public.ops_raw_batch where batch_id = v_run.batch_id;
  if v_batch.source_system <> 'FINANCE_MONTHLY' or v_batch.status <> 'READY' then
    raise exception 'processing run is not backed by a ready FINANCE_MONTHLY batch' using errcode = '23514';
  end if;

  delete from public.fin_month_fact where source_batch_id = v_batch.batch_id;
  delete from public.fin_revenue_day where source_batch_id = v_batch.batch_id;

  insert into public.fin_month_fact (
    source_batch_id, domain, source_row_key, period_month, store_id, store_scope,
    store_name_source, major, sub, item, category, org, source, amount, raw_record
  )
  select v_batch.batch_id,
         row.domain,
         row.source_row_key,
         row.period_month,
         coalesce(nullif(row.store_id, ''), v_batch.store_id),
         coalesce(nullif(row.store_scope, ''), 'STORE'),
         nullif(row.store_name_source, ''),
         nullif(row.major, ''),
         nullif(row.sub, ''),
         nullif(row.item, ''),
         nullif(row.category, ''),
         nullif(row.org, ''),
         nullif(row.source, ''),
         row.amount::numeric(18, 2),
         row.raw_record
  from jsonb_to_recordset(p_month_rows) as row(
    domain text,
    source_row_key text,
    period_month text,
    store_id text,
    store_scope text,
    store_name_source text,
    major text,
    sub text,
    item text,
    category text,
    org text,
    source text,
    amount text,
    raw_record jsonb
  );
  get diagnostics v_month_count = row_count;

  insert into public.fin_revenue_day (
    source_batch_id, business_date, store_id, store_name_source, revenue, gross_sales,
    total_discount, discount_rate, import_source, raw_record
  )
  select v_batch.batch_id,
         row.business_date::date,
         coalesce(nullif(row.store_id, ''), v_batch.store_id),
         nullif(row.store_name_source, ''),
         row.revenue::numeric(18, 2),
         nullif(row.gross_sales, '')::numeric(18, 2),
         nullif(row.total_discount, '')::numeric(18, 2),
         nullif(row.discount_rate, '')::numeric(9, 4),
         nullif(row.import_source, ''),
         row.raw_record
  from jsonb_to_recordset(p_revenue_rows) as row(
    business_date text,
    store_id text,
    store_name_source text,
    revenue text,
    gross_sales text,
    total_discount text,
    discount_rate text,
    import_source text,
    raw_record jsonb
  );
  get diagnostics v_revenue_count = row_count;

  perform public.ops_finish_processing_run(
    p_processing_run_id,
    p_worker_id,
    'SUCCEEDED',
    v_month_count + v_revenue_count,
    v_month_count + v_revenue_count,
    0,
    jsonb_build_object('month_facts', v_month_count, 'revenue_days', v_revenue_count)
  );

  return jsonb_build_object(
    'batch_id', v_batch.batch_id,
    'month_facts', v_month_count,
    'revenue_days', v_revenue_count
  );
end;
$$;

comment on function public.ops_load_finance_monthly(bigint, text, jsonb, jsonb) is
  'Loads one immutable FINANCE_MONTHLY batch into the monthly finance facts and finance-side daily revenue. Rejects a run that is not actively leased, not the finance_monthly pipeline, or not backed by a ready FINANCE_MONTHLY batch.';

create or replace function public.ops_load_finance_cost_cards(
  p_processing_run_id bigint,
  p_worker_id text,
  p_items jsonb,
  p_prices jsonb,
  p_recipes jsonb,
  p_recipe_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '30s'
as $$
declare
  v_run public.ops_processing_run%rowtype;
  v_batch public.ops_raw_batch%rowtype;
  v_items bigint;
  v_prices bigint;
  v_recipes bigint;
  v_recipe_items bigint;
begin
  select * into strict v_run
  from public.ops_processing_run
  where processing_run_id = p_processing_run_id
  for update;

  if v_run.status <> 'RUNNING' or v_run.claimed_by <> p_worker_id or v_run.lease_until <= now() then
    raise exception 'processing run is not actively leased by this worker' using errcode = '55000';
  end if;
  if v_run.pipeline_key <> 'finance_cost_card' then
    raise exception 'processing run pipeline is not finance_cost_card' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_typeof(p_prices) <> 'array'
     or jsonb_typeof(p_recipes) <> 'array' or jsonb_typeof(p_recipe_items) <> 'array' then
    raise exception 'cost card payloads must be arrays' using errcode = '22023';
  end if;

  select * into strict v_batch from public.ops_raw_batch where batch_id = v_run.batch_id;
  if v_batch.source_system <> 'FINANCE_COST_CARD' or v_batch.status <> 'READY' then
    raise exception 'processing run is not backed by a ready FINANCE_COST_CARD batch' using errcode = '23514';
  end if;

  delete from public.fin_cost_recipe_item where source_batch_id = v_batch.batch_id;
  delete from public.fin_cost_recipe where source_batch_id = v_batch.batch_id;
  delete from public.fin_cost_item_price where source_batch_id = v_batch.batch_id;
  delete from public.fin_cost_item where source_batch_id = v_batch.batch_id;

  insert into public.fin_cost_item (
    source_batch_id, legacy_item_id, name, item_type, base_unit, status, source_ref,
    legacy_created_at, legacy_updated_at, raw_record
  )
  select v_batch.batch_id, row.legacy_item_id::bigint, row.name, nullif(row.item_type, ''),
         nullif(row.base_unit, ''), nullif(row.status, ''), nullif(row.source_ref, ''),
         nullif(row.legacy_created_at, '')::timestamptz,
         nullif(row.legacy_updated_at, '')::timestamptz, row.raw_record
  from jsonb_to_recordset(p_items) as row(
    legacy_item_id text, name text, item_type text, base_unit text, status text,
    source_ref text, legacy_created_at text, legacy_updated_at text, raw_record jsonb
  );
  get diagnostics v_items = row_count;

  insert into public.fin_cost_item_price (
    source_batch_id, legacy_price_id, legacy_item_id, supplier, unit_price, currency,
    price_unit, price_quantity, normalized_price_myr, normalized_unit, effective_from,
    effective_to, source, verification_state, verification_note, raw_record
  )
  select v_batch.batch_id, row.legacy_price_id::bigint, row.legacy_item_id::bigint,
         nullif(row.supplier, ''), nullif(row.unit_price, '')::numeric(18, 4),
         nullif(row.currency, ''), nullif(row.price_unit, ''),
         nullif(row.price_quantity, '')::numeric(18, 4),
         nullif(row.normalized_price_myr, '')::numeric(18, 4), nullif(row.normalized_unit, ''),
         nullif(row.effective_from, '')::date, nullif(row.effective_to, '')::date,
         nullif(row.source, ''), nullif(row.verification_state, ''),
         nullif(row.verification_note, ''), row.raw_record
  from jsonb_to_recordset(p_prices) as row(
    legacy_price_id text, legacy_item_id text, supplier text, unit_price text, currency text,
    price_unit text, price_quantity text, normalized_price_myr text, normalized_unit text,
    effective_from text, effective_to text, source text, verification_state text,
    verification_note text, raw_record jsonb
  );
  get diagnostics v_prices = row_count;

  insert into public.fin_cost_recipe (
    source_batch_id, legacy_recipe_id, legacy_item_id, version, status, batch_yield,
    batch_unit, sale_price, effective_from, effective_to, notes, raw_record
  )
  select v_batch.batch_id, row.legacy_recipe_id::bigint, row.legacy_item_id::bigint,
         nullif(row.version, '')::integer, nullif(row.status, ''),
         nullif(row.batch_yield, '')::numeric(18, 4), nullif(row.batch_unit, ''),
         nullif(row.sale_price, '')::numeric(18, 2), nullif(row.effective_from, '')::date,
         nullif(row.effective_to, '')::date, nullif(row.notes, ''), row.raw_record
  from jsonb_to_recordset(p_recipes) as row(
    legacy_recipe_id text, legacy_item_id text, version text, status text, batch_yield text,
    batch_unit text, sale_price text, effective_from text, effective_to text, notes text,
    raw_record jsonb
  );
  get diagnostics v_recipes = row_count;

  insert into public.fin_cost_recipe_item (
    source_batch_id, legacy_recipe_item_id, legacy_recipe_id, component_item_id, quantity,
    unit, net_yield, loss_rate, seq, notes, raw_record
  )
  select v_batch.batch_id, row.legacy_recipe_item_id::bigint, row.legacy_recipe_id::bigint,
         row.component_item_id::bigint, nullif(row.quantity, '')::numeric(18, 6),
         nullif(row.unit, ''), nullif(row.net_yield, '')::numeric(18, 6),
         nullif(row.loss_rate, '')::numeric(9, 6), nullif(row.seq, '')::integer,
         nullif(row.notes, ''), row.raw_record
  from jsonb_to_recordset(p_recipe_items) as row(
    legacy_recipe_item_id text, legacy_recipe_id text, component_item_id text, quantity text,
    unit text, net_yield text, loss_rate text, seq text, notes text, raw_record jsonb
  );
  get diagnostics v_recipe_items = row_count;

  perform public.ops_finish_processing_run(
    p_processing_run_id,
    p_worker_id,
    'SUCCEEDED',
    v_items + v_prices + v_recipes + v_recipe_items,
    v_items + v_prices + v_recipes + v_recipe_items,
    0,
    jsonb_build_object(
      'items', v_items, 'prices', v_prices,
      'recipes', v_recipes, 'recipe_items', v_recipe_items
    )
  );

  return jsonb_build_object(
    'batch_id', v_batch.batch_id,
    'items', v_items,
    'prices', v_prices,
    'recipes', v_recipes,
    'recipe_items', v_recipe_items
  );
end;
$$;

comment on function public.ops_load_finance_cost_cards(bigint, text, jsonb, jsonb, jsonb, jsonb) is
  'Loads one immutable FINANCE_COST_CARD batch into the cost-card tables. Child rows are deleted before parents so a replay never leaves an orphan line.';

create or replace function public.ops_get_finance_summary()
returns jsonb
language sql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
  select jsonb_build_object(
    'month_facts', jsonb_build_object(
      'rows', (select count(*)::bigint from public.v_fin_month_fact_current),
      'store_rows', (select count(*)::bigint from public.v_fin_month_fact_current where store_scope = 'STORE'),
      'group_rows', (select count(*)::bigint from public.v_fin_month_fact_current where store_scope = 'GROUP'),
      'domains', (select count(distinct domain)::bigint from public.v_fin_month_fact_current),
      'first_month', (select min(period_month) from public.v_fin_month_fact_current),
      'last_month', (select max(period_month) from public.v_fin_month_fact_current)
    ),
    'revenue_days', (select count(*)::bigint from public.v_fin_revenue_day_current),
    'cost_cards', jsonb_build_object(
      'items', (select count(*)::bigint from public.v_fin_cost_item_current),
      'prices', (select count(*)::bigint from public.v_fin_cost_item_price_current),
      'recipes', (select count(*)::bigint from public.v_fin_cost_recipe_current),
      'recipe_items', (select count(*)::bigint from public.v_fin_cost_recipe_item_current)
    ),
    'orphans', jsonb_build_object(
      'price_without_item', (
        select count(*)::bigint from public.v_fin_cost_item_price_current as price
        where not exists (
          select 1 from public.v_fin_cost_item_current as item
          where item.legacy_item_id = price.legacy_item_id
        )
      ),
      'recipe_without_item', (
        select count(*)::bigint from public.v_fin_cost_recipe_current as recipe
        where not exists (
          select 1 from public.v_fin_cost_item_current as item
          where item.legacy_item_id = recipe.legacy_item_id
        )
      ),
      'line_without_recipe', (
        select count(*)::bigint from public.v_fin_cost_recipe_item_current as line
        where not exists (
          select 1 from public.v_fin_cost_recipe_current as recipe
          where recipe.legacy_recipe_id = line.legacy_recipe_id
        )
      )
    )
  );
$$;

create or replace function public.ops_get_finance_domain_totals()
returns table (domain text, store_scope text, rows bigint, amount numeric)
language sql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
  select fact.domain, fact.store_scope, count(*)::bigint, sum(fact.amount)
  from public.v_fin_month_fact_current as fact
  group by fact.domain, fact.store_scope
  order by fact.domain, fact.store_scope;
$$;

comment on function public.ops_get_finance_domain_totals() is
  'Row count and summed amount per finance domain and store scope. Counts alone would reconcile even if every amount were zero, so the migration check compares both.';

comment on function public.ops_get_finance_summary() is
  'Aggregate finance-domain health. Reports referential orphans across cost-card levels instead of assuming a clean import; a non-zero orphan count is a real migration defect, not noise.';

-- Finance ingestion capability. Separate from hc_pos_writer: a finance import must never be
-- able to write a POS fact, and vice versa.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'hc_finance_writer') then
    execute 'create role hc_finance_writer nologin noinherit';
  end if;
end;
$$;

grant usage on schema public, extensions to hc_finance_writer;

-- PostgreSQL grants EXECUTE to PUBLIC on every new function. Without these revokes the finance
-- loaders would be callable by anon, authenticated and every worker role, which would defeat the
-- capability split below.
revoke all on function public.ops_load_finance_monthly(bigint, text, jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.ops_load_finance_cost_cards(bigint, text, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.ops_get_finance_summary() from public, anon, authenticated;
revoke all on function public.ops_get_finance_domain_totals() from public, anon, authenticated;

grant execute on function public.ops_register_raw_batch(text, text, text, text, text, timestamptz, timestamptz, bigint, jsonb)
  to hc_finance_writer;
grant execute on function public.ops_register_raw_object(uuid, text, text, character, bigint, text, text, text, text)
  to hc_finance_writer;
grant execute on function public.ops_complete_raw_batch(uuid, bigint, bigint, text[], text, text)
  to hc_finance_writer;

-- service_role is how the finance worker connects, so it needs the loaders - but it must not
-- get a direct read on the fact tables or their views. Reaching finance data has to go through
-- a leased processing run or the aggregate summary, exactly as the POS domain already requires.
revoke all on public.fin_month_fact, public.fin_revenue_day, public.fin_cost_item,
               public.fin_cost_item_price, public.fin_cost_recipe, public.fin_cost_recipe_item
  from public, anon, authenticated, service_role;
revoke all on public.v_fin_month_fact_current, public.v_fin_revenue_day_current,
               public.v_fin_cost_item_current, public.v_fin_cost_item_price_current,
               public.v_fin_cost_recipe_current, public.v_fin_cost_recipe_item_current
  from public, anon, authenticated, service_role;

grant execute on function public.ops_load_finance_monthly(bigint, text, jsonb, jsonb),
                        public.ops_load_finance_cost_cards(bigint, text, jsonb, jsonb, jsonb, jsonb)
  to service_role, hc_ops_processor;

grant execute on function public.ops_get_finance_summary(),
                        public.ops_get_finance_domain_totals()
  to service_role, hc_ops_processor, hc_agent_worker;

comment on role hc_finance_writer is
  'Finance ingestion capability; registers immutable finance Raw batches. It cannot load facts directly - loading stays with hc_ops_processor under an active lease.';
