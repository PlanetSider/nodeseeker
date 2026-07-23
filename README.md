# NodeSeeker

[![Build](https://github.com/PlanetSider/nodeseeker/actions/workflows/docker-build.yml/badge.svg)](https://github.com/PlanetSider/nodeseeker/actions/workflows/docker-build.yml)
[![GHCR](https://img.shields.io/badge/GHCR-nodeseeker-blue)](https://github.com/PlanetSider/nodeseeker/pkgs/container/nodeseeker)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

NodeSeek 社区 RSS 监控与飞书推送服务。项目基于 Bun、Hono 和 SQLite，提供 Web 控制台、关键词订阅、自动抓取、飞书机器人命令和多架构容器镜像。

## 功能

- 定时抓取 NodeSeek RSS，可配置抓取间隔和 HTTP/HTTPS 代理
- 按关键词、严格关键词、正则表达式、作者和分类匹配文章
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

# 停止服务，保留 ./data 和 ./logs
docker compose down
```

默认使用镜像：

```text
ghcr.io/planetsider/nodeseeker:latest
```

部署固定版本时，直接修改 `docker-compose.yml` 中的镜像标签：

```yaml
image: ghcr.io/planetsider/nodeseeker:v1.0
```

### Docker Run

```bash
docker run -d \
  --name nodeseeker \
  --restart unless-stopped \
  -p 3010:3010 \
  -v "$PWD/data:/usr/src/app/data" \
  -v "$PWD/logs:/usr/src/app/logs" \
  ghcr.io/planetsider/nodeseeker:latest
```

## 从源码构建

### Compose 构建

`docker-compose.build.yml` 会覆盖默认镜像配置，使用仓库中的 `Dockerfile` 构建本地镜像：

```bash
git clone https://github.com/PlanetSider/nodeseeker.git
cd nodeseeker

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
  -v "$PWD/data:/usr/src/app/data" \
  -v "$PWD/logs:/usr/src/app/logs" \
  nodeseeker:local
```

## Compose 配置

项目不再提供或读取 `.env` 文件。`docker-compose.yml` 使用固定默认值，数据通过相对目录绑定到宿主机。

| 配置 | 默认值 | 修改方式 |
|------|--------|----------|
| 镜像 | `ghcr.io/planetsider/nodeseeker:latest` | 修改 `docker-compose.yml` 的 `image` |
| 端口 | `3010:3010` | 修改 `docker-compose.yml` 的 `ports` |
| CORS | `http://localhost:3010` | 修改 `environment.CORS_ORIGINS` |
| RSS 超时 | `10000` | 修改 `environment.RSS_TIMEOUT` |
| RSS 定时任务 | `true` | 修改 `environment.RSS_CHECK_ENABLED` |
| 日志级别 | `info` | 修改 `environment.LOG_LEVEL` |

目录映射：

| 宿主机目录 | 容器目录 | 用途 |
|------------|----------|------|
| `./data` | `/usr/src/app/data` | SQLite 数据库 |
| `./logs` | `/usr/src/app/logs` | 应用日志 |

飞书凭据、RSS 地址、抓取间隔和代理保存在 SQLite 中，应通过 Web 控制台配置。

## 飞书配置

### 1. 创建应用

1. 打开[飞书开放平台](https://open.feishu.cn/app)，创建企业自建应用。
2. 启用机器人能力。
3. 开通机器人发送消息、接收消息所需权限。
4. 获取 `App ID` 和 `App Secret`。

### 2. 配置长连接事件订阅

NodeSeeker 使用飞书官方 SDK 的 WebSocket 长连接接收事件，不需要公网回调地址或内网穿透。

在飞书开放平台完成以下设置：

1. 进入“事件与回调”，选择“使用长连接接收事件”。
2. 添加事件 `im.message.receive_v1`。
3. 发布应用版本，并确保目标用户可以使用该应用。

### 3. 在 NodeSeeker 中绑定

1. 登录 NodeSeeker Web 控制台。
2. 打开“飞书配置”。
3. 填写 `App ID` 和 `App Secret`。
4. 保存并测试连接。
5. 在飞书中向机器人发送 `/start`，系统会绑定当前用户及会话。

在群聊中执行 `/start` 时，后续文章会推送到该群聊；在机器人私聊中执行时，会推送到该私聊。

## 飞书命令

| 命令 | 说明 |
|------|------|
| `/start` | 绑定当前用户和会话 |
| `/getme` | 查看 Open ID、Chat ID 和绑定状态 |
| `/list` | 查看订阅列表 |
| `/add 关键词1 -y 关键词2` | 打开卡片，选择一个或多个 RSS 来源添加监控；`-y` 表示前一个关键词严格匹配 |
| `/del 关键词` | 打开卡片，选择一个或多个当前监控的 RSS 来源并取消监控 |
| `/del 订阅ID` | 直接删除指定订阅，兼容旧用法 |
| `/post` | 查看最近十条文章 |
| `/clear 30d` | 清理 30 天以前的文章，也支持 `2m`、`30天`、`2月` |
| `/stop` | 暂停文章推送 |
| `/resume` | 恢复文章推送 |
| `/unbind` | 解除绑定 |
| `/help` | 查看命令帮助 |

关键词支持普通文本和正则表达式：

```text
/add JavaScript React
/add /javascript/i React
/add regex:AI|人工智能 深度学习
/add nc -y vps
```

严格匹配不区分大小写，并且不会匹配较长英文单词中的片段。例如严格关键词 `nc` 可匹配 `NC server`，不会匹配 `ncloud`。

Web 控制台的订阅管理支持为每个关键词单独开启或关闭严格匹配。统计信息中会显示 SQLite 数据库大小，并可按天或月清理旧文章；清理不会删除订阅、账号或飞书配置。

## AI 翻译

设置菜单中的「AI 翻译」页面支持配置 OpenAI 兼容的 Chat Completions API URL、API Key、模型和翻译提示词，并可选择一个或多个命名 RSS 来源。命中关键词的文章仅在来源被选中时翻译标题和正文，再将译文发送到飞书；模型调用失败时自动回退为原文推送。

## 网络要求

飞书长连接只要求 NodeSeeker 运行环境可以主动访问公网飞书开放平台，不要求服务器提供公网 IP、域名或 HTTPS 回调地址。Web 控制台如需公网访问，可按自己的部署环境配置 Nginx、Caddy 或其他反向代理。

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

备份数据目录：

```bash
tar czf nodeseeker-backup.tar.gz data
```

恢复前请先执行 `docker compose down`：

```bash
tar xzf nodeseeker-backup.tar.gz
```

删除 `./data` 会永久删除数据库：

```bash
docker compose down
rm -rf data logs
```

## 故障排查

| 问题 | 检查项 |
|------|--------|
| 容器无法启动 | 执行 `docker compose logs nodeseeker` 查看迁移或端口错误 |
| 页面无法访问 | 检查 `docker compose ps`、端口映射和服务器防火墙 |
| 飞书长连接未连接 | 检查 App ID、App Secret、容器公网访问能力和飞书事件订阅方式 |
| 飞书机器人无回复 | 检查应用版本是否发布、权限、长连接模式和 `im.message.receive_v1` 事件 |
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
