#!/usr/bin/env bash
#
# audit-bucket-setup.sh
#
# One-shot operator script for FUTURE-9 — configures a linode object
# storage bucket for audit-log shipping with S3 object-lock enabled.
#
# CRITICAL LIMITATION: object-lock MUST be enabled at bucket CREATION time.
# You cannot turn it on for an existing bucket via the S3 API. If your
# bucket was created without it, you have to create a new bucket with
# object-lock enabled, then migrate historical audit objects across.
# This script handles both cases: --create for a new bucket,
# --configure for an already-object-lock-enabled bucket.
#
# Object-lock modes:
#   GOVERNANCE — retention enforced; can be bypassed with a special
#                permission. Recommended for day-to-day SOC2 compliance.
#   COMPLIANCE — retention absolute; not even the root account can
#                delete before expiry. Use only when required by a
#                contract (e.g. FINRA 17a-4).
#
# Environment:
#   AUDIT_REMOTE_ACCESS_KEY — linode object-storage access key
#   AUDIT_REMOTE_SECRET_KEY — linode object-storage secret
#   AUDIT_S3_ENDPOINT       — e.g. https://us-east-1.linodeobjects.com
#   AUDIT_BUCKET            — bucket name (mentiko-audit-<env>)
#
# Usage:
#   scripts/audit-bucket-setup.sh --create
#   scripts/audit-bucket-setup.sh --configure
#   scripts/audit-bucket-setup.sh --verify
#
# Options:
#   --create             create a new bucket with object-lock enabled,
#                        set default retention
#   --configure          set default retention on an existing
#                        object-lock-enabled bucket (use if someone else
#                        already created the bucket with --object-lock
#                        but didn't set defaults)
#   --verify             print current object-lock configuration
#   --mode <mode>        GOVERNANCE (default) or COMPLIANCE
#   --days <n>           retention window in days (default 365)
#   --dry-run            print the AWS calls without executing

set -euo pipefail

MODE="GOVERNANCE"
DAYS="365"
ACTION=""
DRY_RUN=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --create)    ACTION="create" ;;
    --configure) ACTION="configure" ;;
    --verify)    ACTION="verify" ;;
    --mode)      MODE="$2"; shift ;;
    --days)      DAYS="$2"; shift ;;
    --dry-run)   DRY_RUN="1" ;;
    -h|--help)
      sed -n '2,/^set -/{/^set -/q; p;}' "$0"
      exit 0
      ;;
    *)
      echo "error: unknown option: $1" >&2
      exit 2
      ;;
  esac
  shift
done

if [[ -z "$ACTION" ]]; then
  echo "error: one of --create, --configure, --verify is required" >&2
  echo "run with --help for details" >&2
  exit 2
fi

# env validation
for var in AUDIT_REMOTE_ACCESS_KEY AUDIT_REMOTE_SECRET_KEY AUDIT_S3_ENDPOINT AUDIT_BUCKET; do
  if [[ -z "${!var:-}" ]]; then
    echo "error: $var is required (source ops .env first)" >&2
    exit 2
  fi
done

if [[ "$MODE" != "GOVERNANCE" && "$MODE" != "COMPLIANCE" ]]; then
  echo "error: --mode must be GOVERNANCE or COMPLIANCE (got: $MODE)" >&2
  exit 2
fi

if ! [[ "$DAYS" =~ ^[0-9]+$ ]] || [[ "$DAYS" -lt 1 ]]; then
  echo "error: --days must be a positive integer (got: $DAYS)" >&2
  exit 2
fi

if [[ -z "$DRY_RUN" ]] && ! command -v aws >/dev/null 2>&1; then
  echo "error: aws-cli not installed. Install with: pip install awscli" >&2
  echo "       (--dry-run works without aws-cli, for previewing the calls)" >&2
  exit 2
fi

# export creds for aws-cli (standard S3 env vars)
export AWS_ACCESS_KEY_ID="$AUDIT_REMOTE_ACCESS_KEY"
export AWS_SECRET_ACCESS_KEY="$AUDIT_REMOTE_SECRET_KEY"
# linode is S3-compatible — region can be any non-empty string; aws-cli
# requires one to sign requests.
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"

run_aws() {
  if [[ -n "$DRY_RUN" ]]; then
    printf 'DRY-RUN: aws'
    for arg in "$@"; do printf ' %q' "$arg"; done
    printf '\n'
  else
    aws --endpoint-url "$AUDIT_S3_ENDPOINT" "$@"
  fi
}

case "$ACTION" in
  create)
    echo "creating bucket '$AUDIT_BUCKET' with object-lock enabled..."
    run_aws s3api create-bucket \
      --bucket "$AUDIT_BUCKET" \
      --object-lock-enabled-for-bucket \
      || { echo "bucket creation failed (already exists?)" >&2; exit 1; }

    echo "enabling bucket versioning (required for object-lock)..."
    run_aws s3api put-bucket-versioning \
      --bucket "$AUDIT_BUCKET" \
      --versioning-configuration Status=Enabled

    echo "applying default object-lock retention: $MODE, $DAYS days..."
    run_aws s3api put-object-lock-configuration \
      --bucket "$AUDIT_BUCKET" \
      --object-lock-configuration "{
        \"ObjectLockEnabled\": \"Enabled\",
        \"Rule\": {
          \"DefaultRetention\": {
            \"Mode\": \"$MODE\",
            \"Days\": $DAYS
          }
        }
      }"

    echo "done. verify with: $0 --verify"
    ;;

  configure)
    echo "applying default object-lock retention to existing bucket..."
    echo "  bucket: $AUDIT_BUCKET"
    echo "  mode:   $MODE"
    echo "  days:   $DAYS"
    echo ""
    echo "If this fails with 'Object Lock configuration does not exist',"
    echo "the bucket was created without --object-lock-enabled-for-bucket"
    echo "and must be recreated."
    echo ""

    run_aws s3api put-object-lock-configuration \
      --bucket "$AUDIT_BUCKET" \
      --object-lock-configuration "{
        \"ObjectLockEnabled\": \"Enabled\",
        \"Rule\": {
          \"DefaultRetention\": {
            \"Mode\": \"$MODE\",
            \"Days\": $DAYS
          }
        }
      }"

    echo "done. verify with: $0 --verify"
    ;;

  verify)
    echo "current object-lock configuration for '$AUDIT_BUCKET':"
    run_aws s3api get-object-lock-configuration \
      --bucket "$AUDIT_BUCKET" \
      || { echo "no object-lock configuration (bucket may need --create or --configure)" >&2; exit 1; }

    echo ""
    echo "versioning status:"
    run_aws s3api get-bucket-versioning --bucket "$AUDIT_BUCKET"
    ;;
esac
