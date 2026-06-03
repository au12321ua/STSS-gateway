/**
 * STSS Gateway — NJS Module
 *
 * Responsibilities:
 *   1. healthCheck — aggregates upstream /api/v1/health statuses
 *
 * Note: Token verification is now handled by nginx-native auth_request
 * with proxy_pass to Auth Service /internal/verify.  Entrypoint
 * pre-fetches the service token at startup (see entrypoint.sh).
 */


/* ═══════════════════════════════════════════════════════════════
 * HEALTH CHECK — aggregated upstream status
 * ═══════════════════════════════════════════════════════════════ */

function healthCheck(r) {
    var results = {};
    var pending = 2;

    function maybeDone() {
        if (pending > 0) return;

        var overall = (results.auth === 'healthy' && results.info === 'healthy')
            ? 'ok'
            : 'degraded';

        r.headersOut['Content-Type'] = 'application/json';
        r.return(200, JSON.stringify({ status: overall, services: results }));
    }

    r.subrequest('/internal/health/auth', { method: 'GET' },
        function (reply) {
            results.auth = reply.status === 200 ? 'healthy' : 'unhealthy';
            pending--;
            maybeDone();
        }
    );

    r.subrequest('/internal/health/info', { method: 'GET' },
        function (reply) {
            results.info = reply.status === 200 ? 'healthy' : 'unhealthy';
            pending--;
            maybeDone();
        }
    );
}


export default {
    healthCheck
};
