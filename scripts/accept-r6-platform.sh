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
  ' <<< "$health" >/dev/null

  echo "remote: BakeryOps R6 retrieval with page citation"
  export R6_SUPABASE_SERVICE_KEY="$r6_key"
  export R6_KNOWLEDGE_SPACE_IDS="10000000-0000-7000-8000-000000000001"
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
  (cd "$ROOT/bakery-ops" && npm run verify:r6-knowledge)

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
