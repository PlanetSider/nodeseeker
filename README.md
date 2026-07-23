# NodeSeeker

[![Build](https://github.com/PlanetSider/nodeseeker/actions/workflows/docker-build.yml/badge.svg)](https://github.com/PlanetSider/nodeseeker/actions/workflows/docker-build.yml)
[![GHCR](https://img.shields.io/badge/GHCR-nodeseeker-blue)](https://github.com/PlanetSider/nodeseeker/pkgs/container/nodeseeker)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

NodeSeeker 是一个 RSS 监控与飞书推送服务。它支持同时管理多个命名 RSS 来源，通过关键词订阅或全量更新模式决定推送内容，并可在发送飞书消息前调用 OpenAI 兼容接口翻译文章。

项目使用 Bun、Hono、SQLite 和飞书官方 Node SDK，提供完整 Web 管理界面和 `linux/amd64`、`linux/arm64` 容器镜像。

## 主要功能

- 管理多个带自定义名称的 RSS 来源
- 支持 NodeSeek、LowEndTalk 以及标准 RSS 2.0 来源
- 每个 RSS 来源可独立启用、停用和手动抓取
- 每个来源可选择关键词订阅模式或新内容直接推送模式
- 按关键词、严格关键词、正则表达式、作者和分类过滤
- 订阅可同时限定到多个 RSS 来源；未指定来源时匹配全部来源
- 飞书 WebSocket 长连接，无需公网 webhook
- 飞书交互卡片选择一个或多个 RSS 来源添加、取消关键词监控
- OpenAI 兼容 Chat Completions 翻译标题和正文
- 每个 RSS 来源可独立开启 AI 翻译
- 统计信息显示 AI 输入、输出和总 Token 消耗
- 首页可按 RSS 来源切换文章列表
- 模型调用失败时自动回退原文推送
- SQLite 数据持久化、统计、文章筛选和旧数据清理
- GitHub Actions 自动测试并发布多架构 GHCR 镜像

## 推送规则

每个 RSS 来源包含三个独立开关：

| 开关 | 作用 |
|------|------|
| 启用 | 控制定时任务是否抓取该 RSS 来源 |
| 开启订阅 | 开启时仅推送命中关键词的文章；关闭时直接推送该来源抓取到的新文章 |
| AI 翻译 | 开启时在推送前翻译该来源文章的标题和正文 |

处理流程：

```text
RSS 抓取
  -> 新文章入库
  -> 来源开启订阅？
     -> 是：匹配关键词、作者和分类
     -> 否：直接进入推送流程
  -> 来源启用 AI 翻译？
     -> 是：翻译标题和正文
     -> 否或翻译失败：使用原文
  -> 飞书推送
```

## 快速部署

### Docker Compose

```bash
git clone https://github.com/PlanetSider/nodeseeker.git
cd nodeseeker
docker compose pull
docker compose up -d
```

打开 `http://localhost:3010`，首次访问时创建管理员账户。

默认镜像：

```text
ghcr.io/planetsider/nodeseeker:latest
```

如需固定版本，修改 `docker-compose.yml`：

```yaml
services:
  nodeseeker:
    image: ghcr.io/planetsider/nodeseeker:v1.5
```

常用命令：

```bash
# 查看状态
docker compose ps

# 查看日志
docker compose logs -f nodeseeker

# 拉取并应用更新
docker compose pull
docker compose up -d

# 停止服务，保留数据
docker compose down
```

### Docker Run

```bash
mkdir -p data logs

docker run -d \
  --name nodeseeker \
  --restart unless-stopped \
  -p 3010:3010 \
  -v "$PWD/data:/usr/src/app/data" \
  -v "$PWD/logs:/usr/src/app/logs" \
  ghcr.io/planetsider/nodeseeker:latest
```

## Compose 配置

项目不依赖 `.env` 文件。容器运行参数直接配置在 `docker-compose.yml` 中，业务配置保存在 SQLite 数据库中。

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `NODE_ENV` | `production` | 运行环境 |
| `PORT` | `3010` | HTTP 服务端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DATABASE_PATH` | `/usr/src/app/data/nodeseeker.db` | SQLite 数据库路径 |
| `CORS_ORIGINS` | `http://localhost:3010` | 允许访问的 Web 来源 |
| `RSS_TIMEOUT` | `10000` | RSS 请求超时，单位毫秒 |
| `RSS_CHECK_ENABLED` | `true` | 是否启动 RSS 定时任务 |
| `LOG_LEVEL` | `info` | `debug`、`info`、`warn`、`error` 或 `silent` |

持久化目录：

| 宿主机 | 容器 | 内容 |
|--------|------|------|
| `./data` | `/usr/src/app/data` | SQLite 数据库和业务配置 |
| `./logs` | `/usr/src/app/logs` | 应用日志 |

RSS 来源、关键词订阅、飞书凭据和 AI API Key 均保存在 SQLite 中。请限制 `data` 目录访问权限并定期备份。

## 初始配置

登录 Web 控制台后，建议按以下顺序配置：

1. 在「RSS 配置」中添加来源名称和 RSS URL。
2. 按来源选择是否启用抓取以及是否开启关键词订阅。
3. 在「订阅管理」中添加关键词、作者或分类条件。
4. 在「飞书配置」中填写 App ID 和 App Secret。
5. 在飞书中向机器人发送 `/start` 绑定推送会话。
6. 如需翻译，在「AI 翻译」中配置模型接口，再回到「RSS 配置」为对应来源开启 AI 翻译。

现有单 RSS 配置升级后会自动迁移为名为 `NodeSeek` 的默认来源。

## RSS 来源

### 支持的标识格式

NodeSeeker 会优先从常见论坛链接或 GUID 中提取文章 ID：

- NodeSeek：`https://www.nodeseek.com/post-12345-1`
- LowEndTalk：`https://lowendtalk.com/discussion/219421/topic-slug`
- Vanilla GUID：`219421@/discussions`
- 常见 URL 参数：`id`、`p`、`post`

对于没有数字 ID 的 RSS，系统会根据 GUID、文章链接或标题生成稳定标识。文章原始链接会保存在数据库中，并用于 Web 列表和飞书推送。

### 抓取策略

- 所有启用来源共用一个抓取间隔和代理设置。
- 定时任务逐个抓取启用的来源。
- 可以在 Web 控制台手动抓取全部来源或单个来源。
- 文章按“RSS 来源 + 文章 ID”判重，不同来源可以存在相同数字 ID。

## 关键词订阅

订阅支持以下条件：

- 最多三个关键词，多个关键词之间为 AND 关系
- 普通包含匹配
- 严格匹配，不区分大小写且不匹配英文单词片段
- `/pattern/i` 格式正则表达式
- `regex:pattern` 格式正则表达式
- 作者过滤
- 分类过滤
- 指定一个或多个 RSS 来源，或不选择来源以匹配全部来源

严格关键词 `nc` 可以匹配 `NC server`，不会匹配 `ncloud`。

## 飞书配置

### 创建应用

1. 打开[飞书开放平台](https://open.feishu.cn/app)，创建企业自建应用。
2. 启用机器人能力。
3. 开通机器人发送消息和接收消息所需权限。
4. 获取 App ID 和 App Secret。

### 配置长连接

NodeSeeker 使用飞书官方 SDK 的 WebSocket 长连接，不需要公网 IP、域名、HTTPS 回调地址或内网穿透。

在飞书开放平台中：

1. 进入「事件与回调」。
2. 选择「使用长连接接收事件」。
3. 添加消息事件 `im.message.receive_v1`。
4. 启用交互卡片回调 `card.action.trigger`。
5. 发布应用版本，并确保目标用户可以使用该应用。

然后在 NodeSeeker 的「飞书配置」中保存 App ID 和 App Secret，并向机器人发送 `/start`。在群聊发送 `/start` 会绑定该群聊，在私聊发送会绑定当前私聊。

### 飞书命令

| 命令 | 说明 |
|------|------|
| `/start` | 绑定当前用户和会话 |
| `/getme` | 查看 Open ID、Chat ID 和绑定状态 |
| `/list` | 查看订阅列表和来源 |
| `/add 关键词1 -y 关键词2` | 打开来源选择卡片；可连续选择多个 RSS 来源 |
| `/del 关键词` | 打开取消卡片；选择要停止监控的 RSS 来源 |
| `/del 订阅ID` | 直接删除指定订阅，兼容旧用法 |
| `/post` | 查看最近十条文章及原始链接 |
| `/clear 30d` | 清理指定时间以前的文章；也支持 `2m`、`30天`、`2月` |
| `/stop` | 暂停文章推送 |
| `/resume` | 恢复文章推送 |
| `/unbind` | 解除绑定 |
| `/help` | 查看帮助 |

示例：

```text
/add JavaScript React
/add /javascript/i React
/add regex:AI|人工智能 深度学习
/add nc -y vps
/del vps
```

`-y` 表示前一个关键词使用严格匹配。卡片操作仅允许当前绑定的飞书用户执行。

## AI 翻译

「AI 翻译」支持 OpenAI 兼容的 Chat Completions 接口，可配置：

- API URL 可填写服务根地址、`/v1` 地址或完整 Chat Completions 地址，例如 `https://api.openai.com/v1`
- API Key，使用 `Authorization: Bearer <key>` 请求
- 模型名称
- 系统提示词

需要翻译的来源在「RSS 配置」中逐个开启。模型响应中的 `usage` 会累计到统计信息，兼容 `prompt_tokens` / `completion_tokens` 和 `input_tokens` / `output_tokens` 字段。

只有进入飞书推送流程且来源被选中的文章才会调用模型。模型需要返回以下 JSON：

```json
{
  "title": "翻译后的标题",
  "content": "翻译后的正文"
}
```

页面中的「抓取并测试推送」会从已开启 AI 翻译的 RSS 来源抓取一篇文章，使用当前表单配置翻译，并将译文发送到已绑定的飞书会话。测试不会保存文章、修改推送状态或自动保存表单配置；失败时页面会显示 RSS、模型或飞书返回的具体错误。正常推送流程中的 AI 请求超时为 30 秒，请求失败或返回格式错误时会记录错误并继续推送原文。

## 升级与迁移

升级前建议先备份 `data` 目录：

```bash
docker compose down
tar czf nodeseeker-backup-$(date +%F).tar.gz data
docker compose pull
docker compose up -d
```

应用启动时会自动执行未运行的 SQLite 迁移。不要手动删除 `data/nodeseeker.db`，否则账号、订阅、文章和全部配置都会丢失。

恢复备份：

```bash
docker compose down
tar xzf nodeseeker-backup-YYYY-MM-DD.tar.gz
docker compose up -d
```

## 从源码运行

需要安装 [Bun](https://bun.sh/)：

```bash
git clone https://github.com/PlanetSider/nodeseeker.git
cd nodeseeker
bun install --frozen-lockfile
bun run db:migrate
bun run dev
```

默认访问地址为 `http://localhost:3010`。

验证代码：

```bash
bun test
bun run build
```

生产构建：

```bash
bun run build
bun run start
```

## 本地构建容器

使用 Compose override：

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.build.yml \
  up -d --build
```

强制无缓存构建：

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.build.yml \
  build --no-cache
```

## GitHub 自动构建

工作流位于 `.github/workflows/docker-build.yml`：

- 推送到 `main`：运行测试、生产构建，并发布 `latest` 和 commit SHA 镜像
- 推送 `v*` 标签：运行测试、生产构建，并发布版本镜像
- Pull Request：只测试和构建，不推送镜像
- 镜像平台：`linux/amd64`、`linux/arm64`

镜像地址：

```text
ghcr.io/planetsider/nodeseeker
```

## 故障排查

| 问题 | 检查项 |
|------|--------|
| 容器无法启动 | 使用 `docker compose logs nodeseeker` 检查迁移、数据库权限和端口占用 |
| 页面无法访问 | 检查 `docker compose ps`、`3010` 端口和服务器防火墙 |
| RSS 抓取失败 | 检查来源 URL、代理、DNS、TLS 和 `RSS_TIMEOUT` |
| 日志提示无法提取文章 ID | 确认使用最新版本；通用 RSS 会根据 GUID 或链接生成稳定标识 |
| 文章重复推送 | 检查来源 URL 是否重复添加，以及数据库目录是否正确持久化 |
| 飞书长连接失败 | 检查 App ID、App Secret、网络访问和长连接接收模式 |
| 飞书机器人不响应 | 检查应用是否发布、消息事件、卡片回调和机器人权限 |
| 飞书没有收到文章 | 先发送 `/start`，再检查来源启用状态、订阅模式和 `/stop` 状态 |
| AI 翻译失败 | 使用页面测试按钮检查完整 API URL、Key、模型和返回 JSON 格式 |

健康检查：

```bash
curl http://localhost:3010/health
```

## 项目结构

```text
src/
├── components/       Web 页面组件
├── config/           环境、数据库和服务配置
├── database/         SQLite 迁移
├── routes/           Hono API 路由
├── services/         RSS、匹配、飞书、AI 和数据库服务
├── types/            TypeScript 类型
└── utils/            校验、日志和通用工具
public/               Web 静态资源
data/                 SQLite 数据目录
logs/                 日志目录
```

## 文档

- [API 文档](API.md)
- [Docker 部署说明](docs/Docker.md)

## License

[MIT](LICENSE)
