/**
 * STSS Gateway — NJS Module
 *
 * Responsibilities:
 *   1. verifyToken  — js_content handler for /internal/auth/verify
 *      a. Obtain a service token (cached, or via /auth/sys/login)
 *      b. Call /api/v1/internal/verify with the service token
 *         and the end-user's Bearer token
 *      c. Store user identity in module-level variables for
 *         downstream header injection via js_set
 *   2. corsHeaderFilter — validates Origin and emits CORS headers
 *   3. healthCheck — aggregates upstream /api/v1/health statuses
 */

/* ────────────────────────────────────────────────────────────────
 * Service Token Cache (module-level — shared across requests
 * within the same Nginx worker process)
 * ──────────────────────────────────────────────────────────────── */
var _serviceToken = null;
var _serviceTokenExpiry = 0;           // epoch milliseconds
var _serviceTokenPending = null;       // array of callbacks while a fetch is in-flight

/* ────────────────────────────────────────────────────────────────
 * User Identity Cache (module-level — written by verifyToken,
 * read synchronously by js_set getters)
 * ──────────────────────────────────────────────────────────────── */
var _userId        = '';
var _userRole      = '';
var _userPermissions = '';


/* ═══════════════════════════════════════════════════════════════
 * SERVICE TOKEN MANAGEMENT
 * ═══════════════════════════════════════════════════════════════ */

/**
 * Fetch (or return a cached) service token.
 *
 * If multiple requests arrive while a token fetch is in flight they
 * share the same subrequest — no thundering-herd on the auth service.
 */
function getServiceToken(r, callback) {
    var now = Date.now();

    // Hit — return cached token (with 60 s safety margin before expiry)
    if (_serviceToken && now < _serviceTokenExpiry) {
        callback(_serviceToken, null);
        return;
    }

    // Pending — queue behind the in-flight fetch
    if (_serviceTokenPending) {
        _serviceTokenPending.push(callback);
        return;
    }

    // Miss — start a new fetch
    _serviceTokenPending = [callback];

    var clientId     = r.variables.gateway_client_id     || 'gateway';
    var clientSecret = r.variables.gateway_client_secret || '';

    var loginBody = JSON.stringify({
        client_id:     clientId,
        client_secret: clientSecret
    });

    r.subrequest('/internal/auth/sys-login',
        { method: 'POST', body: loginBody },
        function (reply) {
            var callbacks = _serviceTokenPending;
            _serviceTokenPending = null;

            if (reply.status === 200) {
                try {
                    var payload = JSON.parse(reply.responseBody);
                    // Auth Service wraps responses in APIResponse:
                    // { code: 0, message: "success", data: { service_token, expires_in, ... } }
                    var data = payload.data || payload;

                    _serviceToken       = data.service_token;
                    // Refresh 60 s before actual expiry
                    _serviceTokenExpiry = now + (data.expires_in - 60) * 1000;

                    for (var i = 0; i < callbacks.length; i++) {
                        callbacks[i](_serviceToken, null);
                    }
                    return;
                } catch (e) {
                    r.error('STSS gateway: cannot parse /auth/sys/login response — ' + e.message);
                }
            }

            // Failure path — reject all queued callers
            for (var j = 0; j < callbacks.length; j++) {
                callbacks[j](null, 'service login returned HTTP ' + reply.status);
            }
        }
    );
}


/**
 * Synchronous getter for js_set — reads the cached service token.
 * Used by /internal/auth/verify-user to set the Authorization header.
 */
function getCachedServiceToken(r) {
    return _serviceToken || '';
}


/* ═══════════════════════════════════════════════════════════════
 * BEARER TOKEN VERIFICATION (js_content handler)
 * ═══════════════════════════════════════════════════════════════ */

function verifyToken(r) {
    // Allow CORS preflight through (shouldn't reach here due to
    // server-level OPTIONS short-circuit, but be defensive).
    if (r.method === 'OPTIONS') {
        r.return(200);
        return;
    }

    var authHeader = r.headersIn['Authorization'] || '';
    var userToken = '';
    if (authHeader.slice(0, 7).toLowerCase() === 'bearer ') {
        userToken = authHeader.slice(7).trim();
    }

    if (!userToken) {
        r.return(401);
        return;
    }

    getServiceToken(r, function (svcToken, err) {
        if (err || !svcToken) {
            r.error('STSS gateway: cannot obtain service token — ' + (err || 'unknown'));
            r.return(502);
            return;
        }

        var verifyBody = JSON.stringify({ token: userToken });

        r.subrequest('/internal/auth/verify-user',
            { method: 'POST', body: verifyBody },
            function (reply) {
                if (reply.status === 200) {
                    try {
                        var payload = JSON.parse(reply.responseBody);
                        // Auth Service wraps in APIResponse:
                        // { data: { user_id, username, role, permissions, token_type } }
                        var data = payload.data || payload;

                        _userId          = String(data.user_id     || '');
                        _userRole        = String(data.role        || '');
                        _userPermissions = Array.isArray(data.permissions)
                            ? data.permissions.join(',')
                            : String(data.permissions || '');

                        r.return(200);
                    } catch (e) {
                        r.error('STSS gateway: cannot parse verify response — ' + e.message);
                        r.return(502);
                    }
                } else if (reply.status === 401 || reply.status === 403) {
                    r.return(reply.status);
                } else {
                    r.error('STSS gateway: verify backend returned HTTP ' + reply.status);
                    r.return(502);
                }
            }
        );
    });
}


/* ═══════════════════════════════════════════════════════════════
 * SYNCHRONOUS GETTERS (for js_set — inject identity into
 * downstream proxy_set_header)
 * ═══════════════════════════════════════════════════════════════ */

function getUserId(r) {
    var val = _userId;
    _userId = '';       // one-shot — cleared after read to prevent
    return val;         // leaking between requests
}
function getUserRole(r) {
    var val = _userRole;
    _userRole = '';
    return val;
}
function getUserPermissions(r) {
    var val = _userPermissions;
    _userPermissions = '';
    return val;
}


/* ═══════════════════════════════════════════════════════════════
 * CORS — header filter
 * ═══════════════════════════════════════════════════════════════ */

function corsHeaderFilter(r) {
    var origin = (r.headersIn['Origin'] || '').trim();
    if (!origin) {
        return;
    }

    var raw     = r.variables.cors_allowed_origins || '';
    var allowed = raw.split(',').map(function (s) { return s.trim(); });

    for (var i = 0; i < allowed.length; i++) {
        if (!allowed[i]) continue;
        if (origin === allowed[i]) {
            r.headersOut['Access-Control-Allow-Origin']      = origin;
            r.headersOut['Access-Control-Allow-Methods']     = 'GET,POST,PUT,DELETE,PATCH,OPTIONS';
            r.headersOut['Access-Control-Allow-Headers']     = 'Authorization,Content-Type,X-Request-ID,X-User-Id,X-User-Role,X-User-Permissions';
            r.headersOut['Access-Control-Allow-Credentials'] = 'true';
            r.headersOut['Access-Control-Max-Age']           = '86400';
            return;
        }
    }
}


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
    // service token
    getCachedServiceToken,
    // auth verification
    verifyToken,
    getUserId,
    getUserRole,
    getUserPermissions,
    // cors
    corsHeaderFilter,
    // health
    healthCheck
};
