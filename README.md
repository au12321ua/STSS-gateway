# STSS Gateway

基于 Nginx 的 STSS（Single Token SSO）平台 API 网关。
支持 **Bearer 令牌校验**、**路由代理**、**限流**、
**CORS** 及 **安全响应头**——全部通过环境变量配置。

## 系统架构

```
浏览器 (SPA) ──→ :8000 Nginx Gateway ──→ :8001 Auth Service
                                      ──→ :8002 Info Service
```

网关是一个**无状态** Nginx 反向代理，借助
[NJS](https://nginx.org/en/docs/njs/) 模块实现：

- 解析 Auth Service 返回的 JSON 校验结果
- 将用户身份注入为下游 HTTP 请求头
- 聚合多个上游服务的健康检查
- 动态校验 CORS Origin

## 快速开始

```bash
# 1. 克隆仓库
git clone <repo-url> && cd STSS-gateway

# 2. 创建 .env（从模板复制后修改密钥）
cp .env.example .env

# 3. 一键启动（从 GHCR 拉取后端镜像 + 本地构建网关）
docker compose up -d

# 4. 首次使用时初始化数据（角色、权限、管理员用户）
docker compose --profile seed up seed

# 5. 验证
curl http://localhost:8000/api/v1/health
```

### 无需后端源码即可测试

网关的 `docker-compose.yml` 默认从 **GitHub Container Registry (GHCR)** 拉取后端镜像：
- `ghcr.io/au12321ua/stss-auth:latest`
- `ghcr.io/au12321ua/stss-info:latest`
- `ghcr.io/au12321ua/stss-seed:latest`

网关本身从本地 `Dockerfile` 构建（如需使用已发布的网关镜像，设置 `GATEWAY_IMAGE` 环境变量）。

### 本地构建后端镜像

如果后端源码（`group1-base`）在 sibling 目录：

```bash
cp docker-compose.override.yml.example docker-compose.override.yml
docker compose build
docker compose up -d
docker compose --profile seed up seed
```

### 私有仓库认证

如果 GHCR 中的镜像为私有，需要先登录：

```bash
echo $GITHUB_TOKEN | docker login ghcr.io -u <your-username> --password-stdin
```

## 路由表

| 路径                    | 上游           | 鉴权      | 备注                  |
|-------------------------|----------------|-----------|-----------------------|
| `/auth/login`           | auth_service   | ❌ 无     | 限流（10 r/m）        |
| `/auth/sys/login`       | auth_service   | ❌ 无     | 限流                  |
| `/auth/logout`          | auth_service   | ✅ Bearer | 登出                  |
| `/auth/refresh`         | auth_service   | ❌ 无     | refresh token 在 body |
| `/auth/me`              | auth_service   | ✅ Bearer | 当前用户信息          |
| `/auth/change-password` | auth_service   | ✅ Bearer | 修改密码              |
| `/auth/public-key`      | auth_service   | ❌ 无     | JWKS 公钥端点         |
| `/api/v1/auth/*`        | auth_service   | ✅ Bearer | Auth 业务 API         |
| `/api/v1/internal/*`    | —              | 🚫 403    | 禁止外网访问          |
| `/api/v1/health`        | 网关自身       | ❌ 无     | 聚合健康检查状态      |
| `/api/v1/info/files*`        | info_service   | ✅ Bearer | 10 MiB，60 s 超时     |
| `/api/v1/info/users/import`  | info_service   | ✅ Bearer | 10 MiB，60 s 超时     |
| `/api/v1/info/*`        | info_service   | ✅ Bearer | Info 业务 API         |
| `/api/v1/schedule/*`    | schedule_service | ✅ Bearer | 排课业务 API          |
| `/api/v1/course-selection/*` | course_selection_service | ✅ Bearer | 智能选课业务 API，支持 SSE |
| `/api/v1/forum/*`       | forum_service  | ✅ Bearer | 论坛业务 API          |
| `/api/v1/online-test/*` | online_test_service | ✅ Bearer | 在线测试业务 API      |
| `/api/v1/grade/*`       | grade_service  | ✅ Bearer | 成绩业务 API          |
| `/`（SPA 静态文件）     | 本地 `dist/`   | —         | 前端静态资源          |

## 鉴权流程

```
1. 客户端请求：GET /api/v1/users  Authorization: Bearer <user_token>
2. 网关作为服务自己先登录：
   POST http://auth_service:8001/api/v1/auth/sys/login
   Body: { "client_id": "gateway", "client_secret": "xxx" }
   → 获取 service_token（缓存复用，到期前 60s 自动刷新）
3. 网关用 service_token 校验用户 token：
   POST http://auth_service:8001/api/v1/internal/verify
   Headers: Authorization: Bearer <service_token>
   Body: { "token": "<user_token>" }
4. Auth Service 先校验 service_token，再校验 user_token
   返回：{ user_id, username, role, permissions, token_type }
5. 网关将身份信息注入下游请求头：
   X-User-Id: <user_id>
   X-User-Role: <role>
   X-User-Permissions: <perm1,perm2,...>
   X-Request-ID: <uuid>
6. 若 verify 返回 401/403 → 网关直接向客户端返回 401/403
```

## 环境变量

| 变量                        | 默认值                                      | 说明                                    |
|-----------------------------|---------------------------------------------|-----------------------------------------|
| `AUTH_SERVICE_URL`          | `auth_service:8001`                         | Auth Service 上游地址                   |
| `INFO_SERVICE_URL`          | `info_service:8002`                         | Info Service 上游地址                   |
| `SCHEDULE_SERVICE_URL`      | `schedule_service:8003`                     | Schedule Service 上游地址               |
| `COURSE_SELECTION_SERVICE_URL` | `course-selection-api:8003`               | Course Selection Service 上游地址       |
| `FORUM_SERVICE_URL`         | `forum_service:8004`                        | Forum Service 上游地址                  |
| `ONLINE_TEST_SERVICE_URL`   | `online_test_service:8005`                  | Online Test Service 上游地址            |
| `GRADE_SERVICE_URL`         | `grade_service:8006`                        | Grade Service 上游地址                  |
| `GATEWAY_PORT`              | `8000`                                      | 网关监听端口                            |
| `CORS_ORIGINS`              | `http://localhost:5173,http://localhost:3000` | 允许的 CORS 域名（逗号分隔）           |
| `RATE_LIMIT_LOGIN`          | `10r/m`                                     | 登录接口限流速率（Nginx 语法）          |
| `GATEWAY_CLIENT_ID`         | `gateway`                                   | 网关服务账号（调用 /internal/verify）   |
| `GATEWAY_CLIENT_SECRET`     | `change-me-gateway-secret`                  | 网关服务账号密钥（需与 Auth 侧一致）    |
| `TOKEN_SECRET_KEY`          | `change-me-in-production`                   | JWT 签名密钥，auth 和 info 服务必须一致 |
| `INFO_SERVICE_CLIENT_SECRET`| `change-me-service-secret`                  | Info Service 调用 Auth Service 的凭据   |
| `ENV`                       | `development`                               | 运行环境（development / production）    |
| `LOG_LEVEL`                 | `DEBUG`                                     | 日志级别                                |

其中排课、选课、论坛、在线测试、成绩服务可以按组逐步接入。未配置或未启动某个业务服务时，Gateway 仍可启动；只有访问对应 `/api/v1/<module>/*` 路由时会返回上游不可用。

### 凭据一致性

以下三个值在网关、Auth Service、Info Service 之间必须一致。
`docker-compose.yml` 已通过引用同一个环境变量自动保证一致性——只需在 `.env` 中设置即可：

```
GATEWAY_CLIENT_SECRET ────────────► auth_service: SERVICE_CLIENT_GATEWAY_SECRET
                                        (gateway 调用 /internal/verify)

INFO_SERVICE_CLIENT_SECRET ───┬──► auth_service: SERVICE_CLIENT_INFO_SERVICE_SECRET
                              └──► info_service: AUTH_SERVICE_CLIENT_SECRET
                                      (info 调用 /auth/sys/login)

TOKEN_SECRET_KEY ───────┬────────► auth_service: TOKEN_SECRET_KEY
                        └────────► info_service:  TOKEN_SECRET_KEY
                                      (JWT 签名/验证)
```

### CORS 域名配置

`CORS_ORIGINS` 接受逗号分隔的精确域名列表：

```bash
# 单个域名（开发环境）
CORS_ORIGINS=http://localhost:5173

# 多个域名（预发布 + 生产环境）
CORS_ORIGINS=https://app.example.com,https://admin.example.com
```

网关**绝不**返回 `Access-Control-Allow-Origin: *`——
只有 `CORS_ORIGINS` 中明确列出的域名才会收到 CORS 响应头。

### 限流速率语法

`RATE_LIMIT_LOGIN` 遵循 [Nginx `limit_req_zone`
rate](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html#limit_req_zone)
语法：

| 值      | 含义              |
|---------|-------------------|
| `10r/m` | 每分钟 10 次请求  |
| `1r/s`  | 每秒 1 次请求     |
| `30r/m` | 每分钟 30 次请求  |

## 请求大小限制

| 路由                   | `client_max_body_size` |
|------------------------|------------------------|
| 所有路由（默认）       | 1 MiB                  |
| `/api/v1/info/files`        | 10 MiB                 |
| `/api/v1/info/users/import` | 10 MiB                 |

## 超时配置

| 场景                         | 连接超时 | 读取超时 |
|------------------------------|----------|----------|
| 默认                         | 5 s      | 30 s     |
| Auth 校验子请求              | 3 s      | 5 s      |
| 文件上传 / CSV 导入          | 5 s      | 60 s     |
| 健康检查探针                 | 3 s      | 3 s      |

## 安全策略

- **CORS**：仅允许明确列出的域名，禁止通配符 `*`
- **内部路由**：`/api/v1/internal/*` 外网请求返回 403
- **登录限流**：通过 `RATE_LIMIT_LOGIN` 可配置
- **安全响应头**：`X-Content-Type-Options: nosniff`、
  `X-Frame-Options: DENY`、`X-XSS-Protection`、`Referrer-Policy`
- **Server Tokens**：已关闭（`server_tokens off`）
- **健康检查**：同时探测两个上游服务，超时 3 s

## Docker 部署

### Compose 部署（推荐）

```bash
# 1. 配置环境变量
cp .env.example .env
# 编辑 .env，至少修改 TOKEN_SECRET_KEY

# 2. 启动全部服务（从 GHCR 拉取镜像）
docker compose up -d

# 3. 初始化种子数据（首次）
docker compose --profile seed up seed

# 4. 验证
curl http://localhost:8000/api/v1/health
```

### 本地构建后端（无需 GHCR）

```bash
cp docker-compose.override.yml.example docker-compose.override.yml
docker compose build
docker compose up -d
```

### 构建网关镜像

```bash
docker build -t stss-gateway .
```

### 独立运行

```bash
docker run -d \
  -p 8000:8000 \
  -e AUTH_SERVICE_URL=auth_service:8001 \
  -e INFO_SERVICE_URL=info_service:8002 \
  -e SCHEDULE_SERVICE_URL=schedule_service:8003 \
  -e COURSE_SELECTION_SERVICE_URL=course-selection-api:8003 \
  -e FORUM_SERVICE_URL=forum_service:8004 \
  -e ONLINE_TEST_SERVICE_URL=online_test_service:8005 \
  -e GRADE_SERVICE_URL=grade_service:8006 \
  -e CORS_ORIGINS=http://localhost:5173 \
  -v $(pwd)/dist:/usr/share/nginx/html \
  --name stss-gateway \
  stss-gateway
```

### Compose 部署（推荐）

```bash
# 生产环境
docker compose up -d

# 附带前端开发服务器
docker compose --profile dev up -d
```

### 挂载 SPA 静态文件

将构建好的前端产物挂载到容器中：

```yaml
gateway:
  volumes:
    - ./frontend/dist:/usr/share/nginx/html
```

## 项目结构

```
STSS-gateway/
├── nginx/
│   └── nginx.conf.template     # Nginx 配置模板（envsubst）
├── njs/
│   └── auth.js                 # NJS 脚本：鉴权、CORS、健康检查
├── docker/
│   └── entrypoint.sh           # 容器入口脚本
├── .github/
│   └── workflows/
│       └── publish.yml         # CI：构建并推送网关镜像到 GHCR
├── Dockerfile
├── docker-compose.yml                  # 主 Compose 文件（GHCR 镜像）
├── docker-compose.override.yml.example # 本地构建后端覆盖文件
├── .env.example                       # 环境变量模板
└── README.md
```

## 测试

```bash
# 健康检查
curl http://localhost:8000/api/v1/health

# 登录（无需 token）
curl -X POST http://localhost:8000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"test","password":"test"}'

# 需要鉴权的请求
curl http://localhost:8000/auth/me \
  -H 'Authorization: Bearer <token>'

# 内部路由被拦截
curl http://localhost:8000/api/v1/internal/verify
# → 403 Forbidden
```
