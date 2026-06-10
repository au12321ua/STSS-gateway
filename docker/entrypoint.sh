#!/bin/sh
# ─────────────────────────────────────────────────────────────────
# STSS Gateway — Docker Entrypoint
#
# 1. Reads environment variables (with defaults)
# 2. Substitutes them into nginx.conf.template via envsubst
# 3. Pre-fetches a service token from Auth Service for auth_request
# 4. Starts Nginx in foreground
# ─────────────────────────────────────────────────────────────────

set -e

# ---- defaults ---------------------------------------------------
export AUTH_SERVICE_URL="${AUTH_SERVICE_URL:-auth_service:8001}"
export INFO_SERVICE_URL="${INFO_SERVICE_URL:-info_service:8002}"
export SCHEDULE_SERVICE_URL="${SCHEDULE_SERVICE_URL:-schedule_service:8003}"
export COURSE_SELECTION_SERVICE_URL="${COURSE_SELECTION_SERVICE_URL:-course-selection-api:8004}"
export FORUM_SERVICE_URL="${FORUM_SERVICE_URL:-forum_service:8005}"
export ONLINE_TEST_SERVICE_URL="${ONLINE_TEST_SERVICE_URL:-online_test_service:8006}"
export GRADE_SERVICE_URL="${GRADE_SERVICE_URL:-grade_service:8007}"
export GATEWAY_PORT="${GATEWAY_PORT:-8000}"
export CORS_ORIGINS="${CORS_ORIGINS:-http://localhost:5173,http://localhost:3000}"
export RATE_LIMIT_LOGIN="${RATE_LIMIT_LOGIN:-10r/m}"
export GATEWAY_CLIENT_ID="${GATEWAY_CLIENT_ID:-gateway}"
export GATEWAY_CLIENT_SECRET="${GATEWAY_CLIENT_SECRET:-change-me-gateway-secret}"

# ---- fetch service token ----------------------------------------
echo "STSS Gateway — fetching service token from ${AUTH_SERVICE_URL}…"

SERVICE_TOKEN=""
MAX_RETRIES=30
RETRY_INTERVAL=2
retry=0

while [ $retry -lt $MAX_RETRIES ]; do
    # Use curl to call /auth/sys/login
    RESP=$(curl -s -X POST "http://${AUTH_SERVICE_URL}/api/v1/auth/sys/login" \
        -H "Content-Type: application/json" \
        -d "{\"client_id\":\"${GATEWAY_CLIENT_ID}\",\"client_secret\":\"${GATEWAY_CLIENT_SECRET}\"}" 2>/dev/null || true)

    # Extract service_token from JSON response: {"data":{"service_token":"..."}}
    SERVICE_TOKEN=$(echo "$RESP" | sed -n 's/.*"service_token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')

    if [ -n "$SERVICE_TOKEN" ]; then
        echo "STSS Gateway — service token obtained successfully"
        break
    fi

    retry=$((retry + 1))
    echo "STSS Gateway — waiting for Auth Service… (attempt $retry/$MAX_RETRIES)"
    sleep $RETRY_INTERVAL
done

if [ -z "$SERVICE_TOKEN" ]; then
    echo "STSS Gateway — ERROR: Could not obtain service token after $MAX_RETRIES attempts"
    exit 1
fi

export SERVICE_TOKEN

# ---- generate final nginx.conf ----------------------------------
echo "STSS Gateway — generating nginx.conf"
echo "  AUTH_SERVICE_URL     = ${AUTH_SERVICE_URL}"
echo "  INFO_SERVICE_URL     = ${INFO_SERVICE_URL}"
echo "  SCHEDULE_SERVICE_URL = ${SCHEDULE_SERVICE_URL}"
echo "  COURSE_SELECTION_SERVICE_URL = ${COURSE_SELECTION_SERVICE_URL}"
echo "  FORUM_SERVICE_URL    = ${FORUM_SERVICE_URL}"
echo "  ONLINE_TEST_SERVICE_URL = ${ONLINE_TEST_SERVICE_URL}"
echo "  GRADE_SERVICE_URL    = ${GRADE_SERVICE_URL}"
echo "  GATEWAY_PORT         = ${GATEWAY_PORT}"
echo "  CORS_ORIGINS         = ${CORS_ORIGINS}"
echo "  RATE_LIMIT_LOGIN     = ${RATE_LIMIT_LOGIN}"
echo "  GATEWAY_CLIENT_ID    = ${GATEWAY_CLIENT_ID}"
# Intentionally not logging GATEWAY_CLIENT_SECRET or SERVICE_TOKEN

envsubst '${AUTH_SERVICE_URL} ${INFO_SERVICE_URL} ${SCHEDULE_SERVICE_URL} ${COURSE_SELECTION_SERVICE_URL} ${FORUM_SERVICE_URL} ${ONLINE_TEST_SERVICE_URL} ${GRADE_SERVICE_URL} ${GATEWAY_PORT} ${CORS_ORIGINS} ${RATE_LIMIT_LOGIN} ${GATEWAY_CLIENT_ID} ${GATEWAY_CLIENT_SECRET} ${SERVICE_TOKEN}' \
    < /etc/nginx/nginx.conf.template \
    > /etc/nginx/nginx.conf

echo "STSS Gateway — starting Nginx on port ${GATEWAY_PORT}…"

exec nginx -g 'daemon off;'
