# NodeSeeker

[![Build](https://github.com/PlanetSider/nodeseeker/actions/workflows/docker-build.yml/badge.svg)](https://github.com/PlanetSider/nodeseeker/actions/workflows/docker-build.yml)
[![GHCR](https://img.shields.io/badge/GHCR-nodeseeker-blue)](https://github.com/PlanetSider/nodeseeker/pkgs/container/nodeseeker)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

NodeSeek 社区 RSS 监控与飞书推送服务。项目基于 Bun、Hono 和 SQLite，提供 Web 控制台、关键词订阅、自动抓取、飞书机器人命令和多架构容器镜像。

## 功能

- 定时抓取 NodeSeek RSS，可配置抓取间隔和 HTTP/HTTPS 代理
- 按关键词、正则表达式、作者和分类匹配文章
- 将匹配结果主动推送至飞书私聊或群聊
- 通过飞书命令添加、查看和删除订阅
- Web 控制台管理订阅、RSS、飞书和推送状态
- SQLite 数据持久化
- GitHub Actions 自动测试并发布 `linux/amd64`、`linux/arm64` 镜像

## 快速部署

### Docker Compose

推荐直接使用 GHCR 已构建镜像：

```bash
git clone https://github.com/PlanetSider/nodeseeker.git
cd nodeseeker
cp .env.example .env
docker compose pull
docker compose up -d
```

访问 `http://localhost:3010` 创建管理员账户。

常用命令：

```bash
# 查看状态
docker compose ps

# 查看日志
docker compose logs -f nodeseeker

# 更新到最新镜像
docker compose pull
docker compose up -d

# 停止服务，保留数据卷
docker compose down
```

默认使用镜像：

```text
ghcr.io/planetsider/nodeseeker:latest
```

部署固定版本可在 `.env` 中设置：

```dotenv
NODESEEKER_IMAGE=ghcr.io/planetsider/nodeseeker:v1.0
```

### Docker Run

```bash
docker run -d \
  --name nodeseeker \
  --restart unless-stopped \
  -p 3010:3010 \
  -v nodeseeker_data:/usr/src/app/data \
  -v nodeseeker_logs:/usr/src/app/logs \
  ghcr.io/planetsider/nodeseeker:latest
```

## 从源码构建

### Compose 构建

`docker-compose.build.yml` 会覆盖默认镜像配置，使用仓库中的 `Dockerfile` 构建本地镜像：

```bash
git clone https://github.com/PlanetSider/nodeseeker.git
cd nodeseeker
cp .env.example .env

docker compose \
  -f docker-compose.yml \
  -f docker-compose.build.yml \
  up -d --build
```

强制重新构建：

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.build.yml \
  build --no-cache

docker compose \
  -f docker-compose.yml \
  -f docker-compose.build.yml \
  up -d
```

### Docker Build

```bash
docker build -t nodeseeker:local .

docker run -d \
  --name nodeseeker \
  --restart unless-stopped \
  -p 3010:3010 \
  -v nodeseeker_data:/usr/src/app/data \
  nodeseeker:local
```

## 环境变量

Compose 会读取同目录的 `.env`。飞书凭据和 RSS 业务配置保存在 SQLite 中，应通过 Web 控制台配置，不需要写进环境变量。

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `NODESEEKER_IMAGE` | `ghcr.io/planetsider/nodeseeker:latest` | Compose 使用的镜像 |
| `PORT` | `3010` | 宿主机映射端口 |
| `CORS_ORIGINS` | `http://localhost:3010` | 允许的跨域来源，多个值用逗号分隔 |
| `RSS_TIMEOUT` | `10000` | RSS 请求超时，单位毫秒 |
| `RSS_CHECK_ENABLED` | `true` | 是否运行 RSS 定时任务 |
| `LOG_LEVEL` | `info` | 日志级别：`debug`、`info`、`warn`、`error` |

容器内数据库固定存储在 `/usr/src/app/data/nodeseeker.db`，Compose 使用 `nodeseeker_data` 卷持久化该目录。

## 飞书配置

### 1. 创建应用

1. 打开[飞书开放平台](https://open.feishu.cn/app)，创建企业自建应用。
2. 启用机器人能力。
3. 开通机器人发送消息、接收消息所需权限。
4. 获取 `App ID` 和 `App Secret`。

### 2. 配置事件订阅

NodeSeeker 必须通过可从公网访问的 HTTPS 地址接收飞书事件：

```text
https://你的域名/feishu/events
```

在飞书开放平台完成以下设置：

1. 进入“事件与回调”，选择“将事件发送至开发者服务器”。
2. 将上述地址设置为请求地址。
3. 添加事件 `im.message.receive_v1`。
4. 复制事件订阅的 `Verification Token`。
5. 发布应用版本，并确保目标用户可以使用该应用。

### 3. 在 NodeSeeker 中绑定

1. 登录 NodeSeeker Web 控制台。
2. 打开“飞书配置”。
3. 填写 `App ID`、`App Secret` 和 `Verification Token`。
4. 保存并测试连接。
5. 在飞书中向机器人发送 `/start`，系统会绑定当前用户及会话。

在群聊中执行 `/start` 时，后续文章会推送到该群聊；在机器人私聊中执行时，会推送到该私聊。

## 飞书命令

| 命令 | 说明 |
|------|------|
| `/start` | 绑定当前用户和会话 |
| `/getme` | 查看 Open ID、Chat ID 和绑定状态 |
| `/list` | 查看订阅列表 |
| `/add 关键词1 关键词2 关键词3` | 添加订阅，最多三个关键词 |
| `/del 订阅ID` | 删除指定订阅 |
| `/post` | 查看最近十条文章 |
| `/stop` | 暂停文章推送 |
| `/resume` | 恢复文章推送 |
| `/unbind` | 解除绑定 |
| `/help` | 查看命令帮助 |

关键词支持普通文本和正则表达式：

```text
/add JavaScript React
/add /javascript/i React
/add regex:AI|人工智能 深度学习
```

## 反向代理

飞书事件订阅要求公网 HTTPS。反向代理需要将原始请求转发至 NodeSeeker，例如 Nginx：

```nginx
location / {
    proxy_pass http://127.0.0.1:3010;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

配置完成后确认以下地址可访问：

```bash
curl https://你的域名/health
```

## 本地开发

需要安装 Bun：

```bash
bun install --frozen-lockfile
bun run db:migrate
bun run dev
```

验证代码：

```bash
bun test
bun run build
```

## GitHub 自动构建

工作流位于 `.github/workflows/docker-build.yml`：

- 推送到 `main`：测试并发布 `latest` 和 commit SHA 标签
- 推送 `v*` 标签：测试并发布对应版本标签
- Pull Request：只测试和构建，不推送镜像
- 支持手动运行 `workflow_dispatch`

发布新版本示例：

```bash
git tag -a v1.1.0 -m "Release v1.1.0"
git push origin v1.1.0
```

镜像地址：

```text
ghcr.io/planetsider/nodeseeker
```

## 数据备份

备份数据卷：

```bash
docker run --rm \
  -v nodeseeker_data:/data \
  -v "$PWD":/backup \
  alpine \
  tar czf /backup/nodeseeker-backup.tar.gz -C /data .
```

恢复前请先执行 `docker compose down`：

```bash
docker run --rm \
  -v nodeseeker_data:/data \
  -v "$PWD":/backup \
  alpine \
  tar xzf /backup/nodeseeker-backup.tar.gz -C /data
```

删除数据卷会永久删除数据库：

```bash
docker compose down -v
```

## 故障排查

| 问题 | 检查项 |
|------|--------|
| 容器无法启动 | 执行 `docker compose logs nodeseeker` 查看迁移或端口错误 |
| 页面无法访问 | 检查 `docker compose ps`、端口映射和服务器防火墙 |
| 飞书 URL 校验失败 | 检查 HTTPS、反向代理、`Verification Token` 和 `/feishu/events` 路径 |
| 飞书机器人无回复 | 检查应用版本是否发布、权限和 `im.message.receive_v1` 事件 |
| 飞书无法推送 | 先发送 `/start` 绑定会话，并检查应用发送消息权限 |
| RSS 抓取失败 | 检查 RSS 地址、代理和容器网络 |

健康检查：

```bash
curl http://localhost:3010/health
```

## 文档

- [Docker 部署说明](docs/Docker.md)
- [API 文档](API.md)

## License

[MIT](LICENSE)
