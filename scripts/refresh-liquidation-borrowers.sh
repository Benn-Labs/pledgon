#!/usr/bin/env bash
# Refresh liquidation-protection borrower lists and roll out both workflow
# deployments in one step. Run from anywhere in the repo; it cd's to the root.
#
#   scripts/refresh-liquidation-borrowers.sh --rpc-url https://... \
#     [--target staging|production] [--from-block 12063724]
#
# Why this exists: the CRE workflows only know borrowers baked into their
# config at deploy time, and the workflow can't self-discover them across
# ticks (docs/architecture.md, "Multi-borrower monitoring"). So after any new
# depositCollateral — or on a schedule once borrower churn justifies it — the
# discovery tool must re-run and both workflow instances must redeploy for
# the new borrower list to take effect. This script is that manual path,
# collapsed to one command; the deploy steps prompt before touching the
# registry.
set -euo pipefail
cd "$(dirname "$0")/.."

RPC_URL=""
TARGET="staging"
FROM_BLOCK="12063724"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --rpc-url)    RPC_URL="${2:?--rpc-url needs a value}"; shift 2 ;;
    --target)     TARGET="${2:?--target needs a value}"; shift 2 ;;
    --from-block) FROM_BLOCK="${2:?--from-block needs a value}"; shift 2 ;;
    -h|--help)    sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
if [[ -z "$RPC_URL" ]]; then
  echo "usage: $0 --rpc-url <sepolia-rpc-url> [--target staging|production] [--from-block <n>]" >&2
  exit 2
fi

echo "==> discovering + classifying borrowers (target: $TARGET)"
go run ./cmd/discover-borrowers --chain-id 11155111 --target "$TARGET" \
  --rpc-url "$RPC_URL" --from-block "$FROM_BLOCK"

echo
echo "==> resulting config diff:"
git diff --stat -- \
  "workflows/liquidation-protection/config.${TARGET}.json" \
  "workflows/liquidation-protection/config.${TARGET}-safe.json" || true

printf '\nRedeploy + activate %s workflows now? [y/N] ' "$TARGET"
read -r answer
if [[ ! "$answer" =~ ^[Yy]$ ]]; then
  echo "skipped. When ready, run:"
  echo "  cre -e .env workflow deploy   workflows/liquidation-protection --target ${TARGET}-settings"
  echo "  cre -e .env workflow activate workflows/liquidation-protection --target ${TARGET}-settings"
  echo "  cre -e .env workflow deploy   workflows/liquidation-protection --target ${TARGET}-safe-settings"
  echo "  cre -e .env workflow activate workflows/liquidation-protection --target ${TARGET}-safe-settings"
  exit 0
fi

cre -e .env workflow deploy   workflows/liquidation-protection --target "${TARGET}-settings"
cre -e .env workflow activate workflows/liquidation-protection --target "${TARGET}-settings"
cre -e .env workflow deploy   workflows/liquidation-protection --target "${TARGET}-safe-settings"
cre -e .env workflow activate workflows/liquidation-protection --target "${TARGET}-safe-settings"

echo
echo "==> done. Redeploys change workflow IDs (config bytes hash into the ID) —"
echo "    update WorkflowID.txt from: cre workflow list"
