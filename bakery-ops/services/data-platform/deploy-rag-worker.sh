#!/bin/bash
set -euo pipefail

ROOT="/Users/weiliangshao/hot"
SERVICE_DIR="$ROOT/bakery-ops/services/data-platform"
SSH_KEY="/Users/weiliangshao/.ssh/xray_tokyo"
REMOTE="root@45.77.12.118"
SSH=(ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=15 -o PreferredAuthentications=publickey -o PasswordAuthentication=no -o ServerAliveInterval=15 -o ServerAliveCountMax=4)

echo "==> worker gates"
cd "$SERVICE_DIR"
uv run pytest >/dev/null
uv run ruff check . >/dev/null
uv export --format requirements-txt --no-dev --frozen --no-emit-project \
  --no-annotate --no-header --output-file requirements.lock >/dev/null

r6_secret=$(security find-generic-password \
  -a weiliangshao -s hotcrush-core-r6-green-secret-key -w)
openrouter_secret=$(uv run python -c \
  'from dotenv import dotenv_values; print(dotenv_values("../../.env").get("OPENROUTER_API_KEY", ""))')
if [ -z "$r6_secret" ] || [ -z "$openrouter_secret" ]; then
  echo "missing R6 or OpenRouter credential" >&2
  exit 65
fi

echo "==> sync isolated worker"
rsync -az --delete --timeout=90 \
  --exclude '.venv' --exclude '.pytest_cache' --exclude '.ruff_cache' \
  --exclude '__pycache__' --exclude '*.pyc' \
  -e "ssh -i $SSH_KEY -o BatchMode=yes -o ConnectTimeout=15 -o PreferredAuthentications=publickey -o PasswordAuthentication=no -o ServerAliveInterval=15 -o ServerAliveCountMax=4" \
  "$SERVICE_DIR/" "$REMOTE:/opt/hotcrush/bakery-ops/services/data-platform/"

scp -O \
  -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=15 \
  -o PreferredAuthentications=publickey -o PasswordAuthentication=no \
  "$SERVICE_DIR/deploy/hotcrush-rag-worker.service" \
  "$REMOTE:/etc/systemd/system/hotcrush-rag-worker.service"

echo "==> install encrypted systemd credentials"
"${SSH[@]}" "$REMOTE" \
  'install -d -m 0700 /etc/credstore.encrypted && systemd-creds setup >/dev/null'
printf '%s' "$r6_secret" | "${SSH[@]}" "$REMOTE" \
  'systemd-creds encrypt --with-key=host --newline=no --name=r6_secret - /etc/credstore.encrypted/hotcrush-r6-secret.cred.new >/dev/null && chmod 0600 /etc/credstore.encrypted/hotcrush-r6-secret.cred.new && mv /etc/credstore.encrypted/hotcrush-r6-secret.cred.new /etc/credstore.encrypted/hotcrush-r6-secret.cred'
printf '%s' "$openrouter_secret" | "${SSH[@]}" "$REMOTE" \
  'systemd-creds encrypt --with-key=host --newline=no --name=openrouter_api_key - /etc/credstore.encrypted/hotcrush-openrouter-api-key.cred.new >/dev/null && chmod 0600 /etc/credstore.encrypted/hotcrush-openrouter-api-key.cred.new && mv /etc/credstore.encrypted/hotcrush-openrouter-api-key.cred.new /etc/credstore.encrypted/hotcrush-openrouter-api-key.cred'
unset r6_secret openrouter_secret

echo "==> build venv and start worker"
"${SSH[@]}" "$REMOTE" '
  set -e
  cd /opt/hotcrush/bakery-ops/services/data-platform
  if ! python3 -c "import ensurepip" >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq python3.11-venv
  fi
  python3 -m venv --clear .venv
  .venv/bin/pip install --disable-pip-version-check --no-cache-dir --require-hashes -r requirements.lock >/dev/null
  .venv/bin/pip install --disable-pip-version-check --no-cache-dir --no-deps . >/dev/null
  systemctl daemon-reload
  systemctl enable --now hotcrush-rag-worker
  systemctl is-active hotcrush-rag-worker
  systemctl show hotcrush-rag-worker -p MainPID -p ActiveState -p SubState --no-pager
'

echo "R6 RAG worker deployed"
