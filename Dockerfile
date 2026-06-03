# ─────────────────────────────────────────────────────────────────
# STSS Gateway — Docker Image
#
# Based on nginx:stable-alpine with the njs dynamic module for
# JavaScript-driven auth processing and header manipulation.
# ─────────────────────────────────────────────────────────────────

FROM nginx:stable-alpine

LABEL org.opencontainers.image.title="STSS Gateway"
LABEL org.opencontainers.image.description="Nginx API Gateway with Bearer-token verification for the STSS platform"
LABEL org.opencontainers.image.authors="BaseInfo-team"

# Install runtime dependencies:
#   gettext — envsubst for config templating
#   curl    — health-check probing
#   Note: the njs dynamic module (ngx_http_js_module.so) is already
#         included in the official nginx:stable-alpine image — no
#         additional package needed.
RUN apk add --no-cache gettext curl

# Verify the njs module exists (fail early if missing)
RUN test -f /usr/lib/nginx/modules/ngx_http_js_module.so || \
    (echo "ERROR: ngx_http_js_module.so not found — is this the official nginx image?" >&2 && exit 1)

# Copy NJS scripts (loaded by nginx.conf via js_import)
COPY njs/ /etc/nginx/njs/

# Copy the Nginx configuration template
COPY nginx/nginx.conf.template /etc/nginx/nginx.conf.template

# Copy the entrypoint script
COPY docker/entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Default SPA content directory (mount your built dist/ here, or
# leave it empty for pure API-gateway use).
RUN mkdir -p /usr/share/nginx/html

# Default port; overridable at runtime via GATEWAY_PORT env var
EXPOSE 8000

STOPSIGNAL SIGQUIT

ENTRYPOINT ["/docker-entrypoint.sh"]
