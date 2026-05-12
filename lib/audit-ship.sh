#!/usr/bin/env bash
# audit-ship.sh - optional remote audit log shipper
#
# reads a single JSONL entry from stdin and ships it to linode object storage.
# feature is disabled if AUDIT_REMOTE_URL is unset (silent no-op).
#
# env vars (optional):
#   AUDIT_REMOTE_URL         full URL with bucket + prefix (e.g. s3://mentiko-audit-prod/tenants/{NAMESPACE_ID}/)
#   AUDIT_REMOTE_ACCESS_KEY  linode object storage access key ID
#   AUDIT_REMOTE_SECRET_KEY  linode object storage secret key
#   NAMESPACE_ID             tenant namespace (for key prefix substitution)
#
# retries: 3 attempts with exponential backoff (1s, 5s, 15s)
# on failure: log to stderr, exit 0 (audit shipping NEVER blocks main flow)

set +e
shopt -s nullglob

# exit 0 silently if remote URL is unset (feature disabled)
if [[ -z "$AUDIT_REMOTE_URL" ]]; then
    exit 0
fi

# read entry from stdin
read -r entry
if [[ -z "$entry" ]]; then
    exit 0
fi

# derive object key from entry timestamp and id
# key format: {NAMESPACE_ID}/YYYY/MM/DD/audit-{epoch_ms}-{short_id}.json
entry_id=$(echo "$entry" | jq -r '.id // "unknown"' 2>/dev/null)
entry_ts=$(echo "$entry" | jq -r '.timestamp // ""' 2>/dev/null)

if [[ -z "$entry_ts" ]]; then
    # fallback if timestamp parsing fails
    epoch_ms=$(($(date +%s) * 1000 + RANDOM % 1000))
else
    # parse iso8601 timestamp to epoch milliseconds
    # handle both "2026-04-22T10:30:45+00:00" and "2026-04-22T10:30:45Z" formats
    epoch_s=$(date -d "$entry_ts" +%s 2>/dev/null)
    if [[ -z "$epoch_s" ]]; then
        # macOS fallback: date doesn't support -d, use perl
        epoch_s=$(perl -le 'use Time::Piece; print Time::Piece->strptime("'"$entry_ts"'", "%Y-%m-%dT%H:%M:%S%z")->epoch' 2>/dev/null)
    fi
    epoch_s=${epoch_s:-$(date +%s)}
    epoch_ms=$((epoch_s * 1000))
fi

short_id="${entry_id##*_}"
short_id="${short_id:0:8}"  # first 8 chars

date_part=$(echo "$entry_ts" | cut -d'T' -f1)  # YYYY-MM-DD
date_part=${date_part:-$(date +%Y-%m-%d)}
year="${date_part:0:4}"
month="${date_part:5:2}"
day="${date_part:8:2}"

# substitute {NAMESPACE_ID} in the URL if present
remote_url="$AUDIT_REMOTE_URL"
remote_url="${remote_url//\{NAMESPACE_ID\}/$NAMESPACE_ID}"

# parse AUDIT_REMOTE_URL into bucket + prefix.
# accepted formats:
#   s3://bucket-name/prefix/path/
#   s3://bucket-name
#   bucket-name  (no scheme, no prefix — fallback)
stripped_url="${remote_url#s3://}"
bucket="${stripped_url%%/*}"
if [[ "$stripped_url" == */* ]]; then
    url_prefix="${stripped_url#*/}"
    url_prefix="${url_prefix%/}"  # trim trailing slash
else
    url_prefix=""
fi

if [[ -z "$bucket" ]]; then
    {
        echo "warn: AUDIT_REMOTE_URL malformed, cannot derive bucket: $remote_url"
    } >&2
    exit 0
fi

# construct the final S3 key with bucket's prefix + date-partitioned path
date_key="${year}/${month}/${day}/audit-${epoch_ms}-${short_id}.json"
if [[ -n "$url_prefix" ]]; then
    remote_key="${url_prefix}/${date_key}"
else
    remote_key="${NAMESPACE_ID}/${date_key}"
fi

# configure rclone via environment variables
# rclone will read these instead of needing a config file
export RCLONE_S3_ACCESS_KEY_ID="$AUDIT_REMOTE_ACCESS_KEY"
export RCLONE_S3_SECRET_ACCESS_KEY="$AUDIT_REMOTE_SECRET_KEY"

# temporary file for the entry
tmp_entry=$(mktemp)
echo "$entry" > "$tmp_entry"
trap 'rm -f "$tmp_entry"' EXIT

# retry logic: 3 attempts with exponential backoff
max_retries=3
backoff_delays=(1 5 15)
attempt=1

while [[ $attempt -le $max_retries ]]; do
    # upload via rclone to bucket + key derived from AUDIT_REMOTE_URL.
    # --s3-provider=Other for linode (S3-compatible)
    # assumes rclone env vars are set for credentials
    # the remote name ":s3:" tells rclone to use inline S3 config from env
    if rclone copyto "$tmp_entry" ":s3:${bucket}/${remote_key}" \
        --s3-provider=Other \
        --s3-endpoint="${AUDIT_S3_ENDPOINT:-}" \
        --s3-env-auth=false \
        --quiet \
        2>/dev/null; then
        # success
        exit 0
    fi

    if [[ $attempt -lt $max_retries ]]; then
        delay=${backoff_delays[$((attempt - 1))]}
        sleep "$delay"
    fi

    attempt=$((attempt + 1))
done

# all retries exhausted: record to local failure log AND stderr.
# we still exit 0 so shipping never blocks main flow — but a silent failure
# where entries disappear forever is not acceptable. the failure log is a
# durable breadcrumb ops can monitor.
failure_log="${AUDIT_DIR:-$NAMESPACE_ROOT/audit}/ship-failures.log"
failure_entry=$(jq -nc \
    --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg eid "$entry_id" \
    --arg key "$remote_key" \
    --arg url "$remote_url" \
    --argjson attempts "$max_retries" \
    '{failed_at: $ts, entry_id: $eid, remote_key: $key, remote_url: $url, attempts: $attempts}' 2>/dev/null)
if [[ -n "$failure_entry" ]]; then
    mkdir -p "$(dirname "$failure_log")"
    echo "$failure_entry" >> "$failure_log"
fi

{
    echo "warn: audit ship failed after $max_retries attempts"
    echo "  entry_id: $entry_id"
    echo "  remote_key: $remote_key"
    echo "  remote_url: $remote_url"
    echo "  logged to: $failure_log"
} >&2

exit 0
