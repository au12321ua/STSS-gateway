#!/bin/sh
# ─────────────────────────────────────────────────────────────────
# STSS Gateway — Docker Entrypoint
#
# 1. Reads environment variables (with defaults)
# 2. Substitutes them into nginx.conf.template via envsubst
# 3. Starts Nginx in foreground
# ─────────────────────────────────────────────────────────────────

set -e

# ---- defaults ---------------------------------------------------
export AUTH_SERVICE_URL="${AUTH_SERVICE_URL:-auth_service:8001}"
export INFO_SERVICE_URL="${INFO_SERVICE_URL:-info_service:8002}"
export GATEWAY_PORT="${GATEWAY_PORT:-8000}"
export CORS_ORIGINS="${CORS_ORIGINS:-http://localhost:5173,http://localhost:3000}"
export RATE_LIMIT_LOGIN="${RATE_LIMIT_LOGIN:-10r/m}"
export GATEWAY_CLIENT_ID="${GATEWAY_CLIENT_ID:-gateway}"
export GATEWAY_CLIENT_SECRET="${GATEWAY_CLIENT_SECRET:-change-me-gateway-secret}"

# ---- generate final nginx.conf ----------------------------------
echo "STSS Gateway — generating nginx.conf"
echo "  AUTH_SERVICE_URL     = ${AUTH_SERVICE_URL}"
echo "  INFO_SERVICE_URL     = ${INFO_SERVICE_URL}"
echo "  GATEWAY_PORT         = ${GATEWAY_PORT}"
echo "  CORS_ORIGINS         = ${CORS_ORIGINS}"
echo "  RATE_LIMIT_LOGIN     = ${RATE_LIMIT_LOGIN}"
echo "  GATEWAY_CLIENT_ID    = ${GATEWAY_CLIENT_ID}"
# Intentionally not logging GATEWAY_CLIENT_SECRET

envsubst '${AUTH_SERVICE_URL} ${INFO_SERVICE_URL} ${GATEWAY_PORT} ${CORS_ORIGINS} ${RATE_LIMIT_LOGIN} ${GATEWAY_CLIENT_ID} ${GATEWAY_CLIENT_SECRET}' \
    < /etc/nginx/nginx.conf.template \
    > /etc/nginx/nginx.conf

echo "STSS Gateway — starting Nginx on port ${GATEWAY_PORT}…"

exec nginx -g 'daemon off;'
