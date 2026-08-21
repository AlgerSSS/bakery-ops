#!/bin/bash
set -euo pipefail

ROOT="/Users/weiliangshao/hot"
R6_REF="tmmkknnkcptunxbfjxqn"
OLD_REF="ecsgqcmwtjmcpzqytdqw"
MODE="${1:-all}"
SUPABASE=(npx --yes supabase@2.115.0)

if [[ "$MODE" != "local" && "$MODE" != "remote" && "$MODE" != "all" ]]; then
  echo "usage: $0 [local|remote|all]" >&2
  exit 64
fi

read_secret() {
  local name="$1"
  local value="${!name:-}"
  if [[ -n "$value" ]]; then
    printf '%s' "$value"
    return
  fi
  local file_name="${name}_FILE"
  local file_path="${!file_name:-}"
  if [[ -n "$file_path" && -f "$file_path" ]]; then
    tr -d '\r\n' < "$file_path"
  fi
}

assert_isolation() {
  local linked_ref
  linked_ref=$(tr -d '\r\n' < "$ROOT/supabase/.temp/project-ref")
  [[ "$linked_ref" == "$R6_REF" ]] || {
    echo "linked Supabase project is not R6: $linked_ref" >&2
    exit 65
  }
  local config_file
  for config_file in "$ROOT/bakery-ops/.env" "$ROOT/res_api/.env"; do
    rg -q "$OLD_REF" "$config_file" || {
      echo "old application config no longer points to the old production ref: $config_file" >&2
      exit 65
    }
    if rg -q "$R6_REF" "$config_file"; then
      echo "R6 ref must not be written into old application config: $config_file" >&2
      exit 65
    fi
  done
  echo "isolation: linked R6; old application configs unchanged"
}

run_local() {
  echo "local: replay migrations and pgTAP"
  (cd "$ROOT" && "${SUPABASE[@]}" db reset --local --yes)
  (cd "$ROOT" && "${SUPABASE[@]}" test db --local)
  (cd "$ROOT" && "${SUPABASE[@]}" db lint --local --schema public,private --level error --fail-on error)

  echo "local: PDF/RAG and POS workers"
  (cd "$ROOT/bakery-ops/services/data-platform" && uv run pytest -q && uv run ruff check .)

  echo "local: RES ingestion clients"
  (cd "$ROOT/res_api" && npm run test:unit && npm test)

  echo "local: BakeryOps application"
  (cd "$ROOT/bakery-ops" && npx tsc --noEmit && npx vitest run && npm run build)
}

run_remote() {
  local r6_url="${R6_SUPABASE_URL:-}"
  local r6_key
  r6_key=$(read_secret R6_SUPABASE_SERVICE_KEY)
  [[ "$r6_url" == "https://$R6_REF.supabase.co" ]] || {
    echo "R6_SUPABASE_URL must be the isolated R6 project" >&2
    exit 65
  }
  [[ -n "$r6_key" ]] || {
    echo "R6_SUPABASE_SERVICE_KEY or its _FILE variant is required" >&2
    exit 65
  }

  echo "remote: migration alignment and lint"
  local migration_json local_count
  migration_json=$(cd "$ROOT" && "${SUPABASE[@]}" migration list --linked)
  local_count=$(find "$ROOT/supabase/migrations" -maxdepth 1 -type f -name '*.sql' | wc -l | tr -d ' ')
  jq -e --argjson expected "$local_count" '
    (.migrations | length) == $expected
    and (.migrations | all(.local != "" and .local == .remote))
  ' <<< "$migration_json" >/dev/null
  (cd "$ROOT" && "${SUPABASE[@]}" db lint --linked --schema public,private --level error --fail-on error)

  echo "remote: platform health invariants"
  local health
  health=$(curl -fsS "$r6_url/rest/v1/rpc/ops_get_platform_health" \
    -H "apikey: $r6_key" \
    -H "authorization: Bearer $r6_key" \
    -H 'content-type: application/json' \
    --data '{}')
  jq -e '
    .raw.stale_receiving == 0
    and .processing.pending == 0
    and .processing.expired_leases == 0
    and .processing.failed_or_dead == 0
    and .rag.pending == 0
    and .rag.expired_leases == 0
    and .rag.failed_or_dead == 0
    and .agents.pending == 0
    and .agents.expired_leases == 0
    and .agents.failed_or_dead == 0
    and .storage.registered_missing_object == 0
    and .storage.object_missing_registration == 0
    and .cron.active_jobs == .cron.expected_jobs
    and .sources.enabled_connectors == 8
    and .sources.stale_connectors == 0
    and .sources.failed_connectors == 0
    and .sources.running_scans <= 1
    and .sources.stale_running_scans == 0
    and .sources.failed_items == 0
    and .sources.missing_items == 0
  ' <<< "$health" >/dev/null

  echo "remote: stable PDF baseline plus dynamic Lark RAG invariants"
  local rag_audit
  rag_audit=$(cd "$ROOT" && "${SUPABASE[@]}" db query --linked --output-format json "
    with current_documents as (
      select *
      from public.ai_raw_document
      where status = 'READY' and is_current
    ), lark_documents as (
      select distinct item.current_document_id as document_id
      from public.ai_source_item as item
      where item.current_document_id is not null
    ), current_chunks as (
      select chunk.chunk_id, chunk.document_id, chunk.page_from, chunk.page_to
      from public.ai_document_chunk as chunk
      join current_documents as document
        on document.document_id = chunk.document_id
       and document.published_ingest_run_id = chunk.ingest_run_id
    )
    select
      (select count(*)::integer from current_documents) as ready_documents,
      (select coalesce(sum(page_count), 0)::integer from current_documents) as ready_pages,
      (select count(*)::integer from current_chunks) as current_chunks,
      (select count(*)::integer from public.ai_chunk_embedding as embedding
       join current_chunks using (chunk_id)) as current_embeddings,
      (select count(*)::integer
       from current_documents as document
       where not exists (
         select 1 from lark_documents where document_id = document.document_id
       )) as non_lark_ready_documents,
      (select coalesce(sum(document.page_count), 0)::integer
       from current_documents as document
       where not exists (
         select 1 from lark_documents where document_id = document.document_id
       )) as non_lark_ready_pages,
      (select count(*)::integer
       from current_chunks as chunk
       where not exists (
         select 1 from lark_documents where document_id = chunk.document_id
       )) as non_lark_current_chunks,
      (select count(*)::integer
       from public.ai_chunk_embedding as embedding
       join current_chunks as chunk using (chunk_id)
       where not exists (
         select 1 from lark_documents where document_id = chunk.document_id
       )) as non_lark_current_embeddings,
      (select count(*)::integer
       from public.ai_source_item where status = 'SYNCED') as lark_synced_items,
      (select count(*)::integer
       from public.ai_source_item as item
       join current_documents as document on document.document_id = item.current_document_id
       where item.status = 'SYNCED') as lark_ready_documents,
      (select count(*)::integer
       from current_chunks as chunk
       join public.ai_source_item as item on item.current_document_id = chunk.document_id
       where item.status = 'SYNCED') as lark_current_chunks,
      (select count(*)::integer
       from public.ai_chunk_embedding as embedding
       join current_chunks as chunk using (chunk_id)
       join public.ai_source_item as item on item.current_document_id = chunk.document_id
       where item.status = 'SYNCED') as lark_current_embeddings,
      (select count(*)::integer
       from current_chunks as chunk
       join current_documents as document on document.document_id = chunk.document_id
       join public.ai_source_item as item on item.current_document_id = chunk.document_id
       where item.status = 'SYNCED'
         and document.document_type = 'LARK_DOCX'
         and (chunk.page_from is not null or chunk.page_to is not null)) as lark_docx_page_gaps,
      (select count(*)::integer
       from public.ai_source_item as item
       left join current_documents as document on document.document_id = item.current_document_id
       where item.status = 'SYNCED' and document.document_id is null) as lark_ready_gaps,
      (select count(*)::integer
       from public.ai_source_item
       where missing_scan_count > 0 or status in ('FAILED', 'MISSING')) as lark_source_gaps,
      (select count(*)::integer
       from public.ai_source_item as item
       where item.status = 'SYNCED'
         and (item.source_uri is null or item.source_uri !~ '^https://')) as lark_citation_gaps,
      (select count(*)::integer from public.ai_document_review) as review_approvals,
      (select count(*)::integer from public.ai_document_review
       where length(manifest_sha256) = 64 and length(source_sha256) = 64) as manifest_bound_reviews,
      (select count(*)::integer
       from current_documents as document
       left join public.ops_raw_object as raw_object
         on raw_object.raw_object_id = document.raw_object_id
       left join public.ai_document_review as review
         on review.document_id = document.document_id
        and review.source_sha256 = btrim(raw_object.sha256)
       where document.data_class = 'C2' and review.review_id is null) as review_audit_gaps;
  ")
  jq -e '
    .rows[0] as $row
    | $row.ready_documents == ($row.non_lark_ready_documents + $row.lark_ready_documents)
      and $row.current_chunks == ($row.non_lark_current_chunks + $row.lark_current_chunks)
      and $row.current_embeddings == ($row.non_lark_current_embeddings + $row.lark_current_embeddings)
      and $row.non_lark_ready_documents == 6
      and $row.non_lark_ready_pages == 108
      and $row.non_lark_current_chunks == 113
      and $row.non_lark_current_embeddings == 113
      and $row.lark_synced_items > 0
      and $row.lark_ready_documents == $row.lark_synced_items
      and $row.lark_current_chunks >= $row.lark_ready_documents
      and $row.lark_current_embeddings == $row.lark_current_chunks
      and $row.lark_docx_page_gaps == 0
      and $row.lark_ready_gaps == 0
      and $row.lark_source_gaps == 0
      and $row.lark_citation_gaps == 0
      and $row.review_approvals >= 3
      and $row.manifest_bound_reviews == $row.review_approvals
      and $row.review_audit_gaps == 0
  ' <<< "$rag_audit" >/dev/null

  echo "remote: Tokyo Lark timer and RAG worker"
  ssh -i "/Users/weiliangshao/.ssh/xray_tokyo" \
    -o BatchMode=yes -o ConnectTimeout=15 \
    -o PreferredAuthentications=publickey -o PasswordAuthentication=no \
    root@45.77.12.118 '
      set -e
      test "$(systemctl is-active hotcrush-lark-wiki-sync.timer)" = active
      test "$(systemctl is-enabled hotcrush-lark-wiki-sync.timer)" = enabled
      systemctl show hotcrush-lark-wiki-sync.timer -p TimersMonotonic --value \
        | grep -Fq "OnUnitActiveUSec=1h"
      test "$(systemctl show hotcrush-lark-wiki-sync.service -p Result --value)" = success
      test "$(systemctl show hotcrush-lark-wiki-sync.service -p ExecMainStatus --value)" = 0
      test "$(systemctl is-active hotcrush-rag-worker)" = active
    '

  echo "remote: full historical POS reconciliation"
  export R6_SUPABASE_SECRET_KEY="$r6_key"
  (cd "$ROOT/res_api" && node scripts/verify-r6-pos-history.js \
    --from=2025-12-03 \
    --to=2026-08-19 \
    '--old-store=吉隆坡Pavilion门店' \
    --r6-store=HC001 \
    | jq -e '
      select(
        .ok
        and .totals.requestedDays == 260
        and .totals.processDays == 229
        and .totals.quarantineDays == 31
        and .totals.r6DailyRows == 229
        and .totals.r6HourlyRows == 2699
        and .totals.r6LegacyBatches == 260
        and .totals.mismatchCount == 0
      )
      | {ok, sourceProjectRef, targetProjectRef, fromDate, toDate, totals}
    ')

  echo "remote: BakeryOps R6 retrieval with page citations"
  export R6_SUPABASE_SERVICE_KEY="$r6_key"
  local embed_key
  embed_key=$(read_secret AI_EMBED_API_KEY)
  if [[ -z "$embed_key" ]]; then
    embed_key=$(read_secret OPENROUTER_API_KEY)
  fi
  [[ -n "$embed_key" ]] || {
    echo "AI_EMBED_API_KEY / OPENROUTER_API_KEY or a _FILE variant is required" >&2
    exit 65
  }
  export AI_EMBED_API_KEY="$embed_key"
  verify_knowledge() {
    local space_id="$1"
    local query="$2"
    local expected_title="$3"
    local expected_page="$4"
    local attempt
    for attempt in 1 2 3; do
      if (cd "$ROOT/bakery-ops" && \
        R6_KNOWLEDGE_SPACE_IDS="$space_id" \
        R6_VERIFY_QUERY="$query" \
        R6_VERIFY_EXPECTED_TITLE="$expected_title" \
        R6_VERIFY_EXPECTED_PAGE="$expected_page" \
        npm run verify:r6-knowledge); then
        return 0
      fi
      if [[ "$attempt" -lt 3 ]]; then
        echo "knowledge verification transient failure; retrying ($attempt/3)" >&2
        sleep $((attempt * 2))
      fi
    done
    return 1
  }

  verify_knowledge \
    "10000000-0000-7000-8000-000000000001" \
    "JobStreet Advanced RM 975 posting price" \
    "JobStreet_AJobThing_职位发布价格对比" \
    "第 1 页"
  verify_knowledge \
    "10000000-0000-7000-8000-000000000006" \
    "L1-L4 与 L1-L5 会员方案成本和主要风险有什么差异" \
    "会员L1-L4与L1-L5方案对比表-20260728" \
    "第 2 页"
  verify_knowledge \
    "10000000-0000-7000-8000-000000000007" \
    "试用期 7 天、30 天、60 天、90 天分别适用于什么员工" \
    "HOT_CRUSH_人力资源制度文件" \
    "第 11 页"
  verify_knowledge \
    "10000000-0000-7000-8000-000000000001" \
    "吉隆坡 Pavilion 门店营业资料" \
    "🏬 吉隆坡Pavilion店" \
    "在线文档"

  if [[ "${R6_ACCEPTANCE_DEEP:-0}" == "1" ]]; then
    echo "remote: deep schema replay diff"
    (cd "$ROOT" && "${SUPABASE[@]}" db diff --linked --schema public,private)
  fi
}

cd "$ROOT"
assert_isolation
if [[ "$MODE" == "local" || "$MODE" == "all" ]]; then
  run_local
fi
if [[ "$MODE" == "remote" || "$MODE" == "all" ]]; then
  run_remote
fi
echo "R6 acceptance passed: mode=$MODE"
