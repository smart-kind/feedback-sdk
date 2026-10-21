#!/usr/bin/env bash
# Deploy server/deno/main.ts to Deno Deploy.
# Usage:
#   bash server/deno/deploy.sh           # preview (non-prod)
#   bash server/deno/deploy.sh --prod    # production
#
# Required env:
#   DENO_PROJECT   Deno Deploy project name (default: feedback-sdk)
#   ADMIN_KEY      Admin key for /update-status & /remove
#   DEPLOY_TOKEN   (CI only) deployctl token
#
# First time? `deno install -Ar jsr:@deno/deployctl` then `deployctl login`.

set -euo pipefail

# Ensure deno tools are in PATH
export PATH="$HOME/.deno/bin:$PATH"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENTRY="$ROOT/server/deno/main.ts"

PROD=false
for arg in "$@"; do
  case "$arg" in
    --prod) PROD=true ;;
    -h|--help)
      echo "Usage: $0 [--prod]"
      echo "  env: DENO_PROJECT ADMIN_KEY DEPLOY_TOKEN"
      exit 0
      ;;
    *) echo "Unknown arg: $arg" >&2; exit 1 ;;
  esac
done

command -v deployctl >/dev/null 2>&1 || {
  echo "deployctl not found. Install:"
  echo "  deno install -Ar jsr:@deno/deployctl"
  echo "  deployctl login"
  exit 1
}

PROJECT="${DENO_PROJECT:-feedback-sdk}"
ARGS=(
  deploy
  --project="$PROJECT"
  --entrypoint="$(basename "$ENTRY")"
)

if [[ "$PROD" == "true" ]]; then
  ARGS+=(--prod)
  echo "→ Deploying $PROJECT (prod) from $ENTRY"
else
  echo "→ Deploying $PROJECT (preview) from $ENTRY"
fi

# Pass env vars to Deno Deploy (runtime env, not build-time).
if [[ -n "${ADMIN_KEY:-}" ]]; then
  ARGS+=(--env=ADMIN_KEY="$ADMIN_KEY")
fi
if [[ -n "${ALLOWED_ORIGIN:-}" ]]; then
  ARGS+=(--env=ALLOWED_ORIGIN="$ALLOWED_ORIGIN")
fi

cd "$ROOT"
# Load .env if present
if [[ -f "$ROOT/.env" ]]; then
  set -a
  source "$ROOT/.env"
  set +a
fi
cd "$ROOT/server/deno"
exec deployctl "${ARGS[@]}"
