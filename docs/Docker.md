# Docker 部署说明

项目提供两种 Compose 使用方式：

- `docker-compose.yml`：直接运行 GHCR 中已发布的镜像，适合服务器部署。
- `docker-compose.build.yml`：叠加到默认配置，从当前源码构建镜像。

## 镜像部署

```bash
git clone https://github.com/PlanetSider/nodeseeker.git
cd nodeseeker

docker compose pull
docker compose up -d
```

默认镜像为 `ghcr.io/planetsider/nodeseeker:latest`。固定版本可直接修改 `docker-compose.yml`：

```yaml
image: ghcr.io/planetsider/nodeseeker:v1.0
```

更新服务：

```bash
docker compose pull
docker compose up -d
```

## 源码构建

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.build.yml \
  up -d --build
```

检查合并后的 Compose 配置：

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.build.yml \
  config
```

不使用 Compose 时可直接构建：

```bash
docker build -t nodeseeker:local .
```

## 服务管理

```bash
# 服务状态
docker compose ps

# 实时日志
docker compose logs -f nodeseeker

# 重启
docker compose restart nodeseeker

# 停止并删除容器，保留 ./data 和 ./logs
docker compose down
```

## 数据持久化

Compose 不使用命名卷，直接映射到项目目录：

| 宿主机目录 | 容器路径 | 用途 |
|------------|----------|------|
| `./data` | `/usr/src/app/data` | SQLite 数据库 |
| `./logs` | `/usr/src/app/logs` | 应用日志 |

备份数据库目录：

```bash
tar czf nodeseeker-backup.tar.gz data
```

删除容器和数据目录：

```bash
docker compose down
rm -rf data logs
```

删除 `./data` 会永久删除 SQLite 数据库，执行前应先备份。

## HTTPS 与飞书回调

飞书事件订阅必须能够通过公网 HTTPS 访问：

```text
https://你的域名/feishu/events
```

NodeSeeker 自身监听容器内 `3010` 端口，建议使用 Nginx、Caddy 或现有网关终止 TLS，再转发到宿主机 `3010` 端口。

Nginx 示例：

```nginx
location / {
    proxy_pass http://127.0.0.1:3010;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

## 健康检查

```bash
curl http://localhost:3010/health
docker inspect --format '{{json .State.Health}}' nodeseeker
```

## 常见问题

### GHCR 镜像无法拉取

当前项目镜像应为公开镜像。先确认镜像名称和网络：

```bash
docker pull ghcr.io/planetsider/nodeseeker:latest
```

### 宿主机端口冲突

修改 `docker-compose.yml` 中的端口映射，例如将 `3010:3010` 改为 `8080:3010`。如果前端域名变化，同步修改 `environment.CORS_ORIGINS`。

### 容器反复重启

```bash
docker compose ps
docker compose logs nodeseeker
```

重点检查数据库迁移、数据卷权限和端口配置。
