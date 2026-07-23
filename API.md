# NodeSeeker API 文档

## 基础信息

- **Base URL**: `http://localhost:3010`
- **认证方式**: JWT Bearer Token
- **Content-Type**: `application/json`

## 认证流程

### 1. 检查系统状态
```http
GET /auth/status
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "initialized": false,
    "message": "系统尚未初始化"
  }
}
```

### 2. 系统初始化（首次使用）
```http
POST /auth/init
Content-Type: application/json

{
  "username": "admin",
  "password": "password123",
  "confirmPassword": "password123"
}
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "username": "admin",
      "isInitialized": true
    }
  },
  "message": "系统初始化成功"
}
```

### 3. 用户登录
```http
POST /auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "password123"
}
```

### 4. 验证 Token
```http
GET /auth/verify
Authorization: Bearer <token>
```

## 配置管理

### 获取系统配置
```http
GET /api/config
Authorization: Bearer <token>
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "id": 1,
    "username": "admin",
    "feishu_app_id": "cli_xxxxxxxxxxxxx",
    "feishu_chat_id": "oc_xxxxxxxxxxxxx",
    "has_feishu_app_secret": true,
    "bound_user_name": "John Doe",
    "bound_user_username": "johndoe",
    "stop_push": 0,
    "only_title": 0,
    "rss_url": "https://rss.nodeseek.com/",
    "rss_interval_seconds": 60,
    "rss_proxy": null,
    "created_at": "2024-01-01T00:00:00.000Z",
    "updated_at": "2024-01-01T00:00:00.000Z"
  }
}
```

### 更新系统配置
```http
PUT /api/config
Authorization: Bearer <token>
Content-Type: application/json

{
  "feishu_app_id": "cli_xxxxxxxxxxxxx",
  "feishu_app_secret": "your-app-secret",
  "feishu_chat_id": "oc_xxxxxxxxxxxxx",
  "stop_push": 0,
  "only_title": 1,
  "rss_url": "https://rss.nodeseek.com/",
  "rss_interval_seconds": 60,
  "rss_proxy": "http://127.0.0.1:7890"
}
```

### 测试飞书连接
```http
POST /api/feishu/test
Authorization: Bearer <token>
Content-Type: application/json

{
  "app_id": "cli_xxxxxxxxxxxxx",
  "app_secret": "your-app-secret",
  "chat_id": "oc_xxxxxxxxxxxxx"
}
```

## 订阅管理

### 获取订阅列表
```http
GET /api/subscriptions
Authorization: Bearer <token>
```

**响应示例**:
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "keyword1": "Docker",
      "keyword2": "容器",
      "keyword3": null,
      "creator": null,
      "category": "tech",
      "created_at": "2024-01-01T00:00:00.000Z",
      "updated_at": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

### 添加订阅
```http
POST /api/subscriptions
Authorization: Bearer <token>
Content-Type: application/json

{
  "keyword1": "Docker",
  "keyword2": "容器",
  "keyword3": "部署",
  "creator": "admin",
  "category": "tech"
}
```

### 更新订阅
```http
PUT /api/subscriptions/1
Authorization: Bearer <token>
Content-Type: application/json

{
  "keyword1": "Kubernetes",
  "keyword2": "K8s"
}
```

### 删除订阅
```http
DELETE /api/subscriptions/1
Authorization: Bearer <token>
```

## 文章管理

### 获取文章列表
```http
GET /api/posts?page=1&limit=20&pushStatus=0&creator=admin&category=tech
Authorization: Bearer <token>
```

**查询参数**:
- `page`: 页码（默认: 1）
- `limit`: 每页数量（默认: 30，最大: 100）
- `pushStatus`: 推送状态（0: 未推送, 1: 已推送, 2: 无需推送）
- `creator`: 创建者筛选
- `category`: 分类筛选

**响应示例**:
```json
{
  "success": true,
  "data": {
    "posts": [
      {
        "id": 1,
        "post_id": 12345,
        "title": "Docker 容器化部署指南",
        "memo": "详细介绍如何使用 Docker 进行应用容器化部署...",
        "category": "tech",
        "creator": "admin",
        "push_status": 0,
        "sub_id": null,
        "pub_date": "2024-01-01T00:00:00.000Z",
        "push_date": null,
        "created_at": "2024-01-01T00:00:00.000Z"
      }
    ],
    "total": 100,
    "page": 1,
    "totalPages": 5
  }
}
```

### 手动抓取 RSS
```http
POST /api/rss/fetch
Authorization: Bearer <token>
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "new": 5,
    "updated": 0,
    "skipped": 15
  },
  "message": "RSS 更新成功"
}
```

### 手动推送文章
```http
POST /api/posts/12345/push/1
Authorization: Bearer <token>
```

## 统计信息

### 获取系统统计
```http
GET /api/stats
Authorization: Bearer <token>
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "total_posts": 1000,
    "unpushed_posts": 50,
    "pushed_posts": 800,
    "skipped_posts": 150,
    "total_subscriptions": 10,
    "today_posts": 25,
    "today_messages": 15,
    "last_update": "2024-01-01T12:00:00.000Z"
  }
}
```

### 获取匹配统计
```http
GET /api/match-stats
Authorization: Bearer <token>
```

## 系统管理

### 数据清理
```http
POST /api/cleanup
Authorization: Bearer <token>
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "deletedCount": 100
  },
  "message": "清理完成，删除了 100 条记录"
}
```

### RSS 配置管理

#### 获取 RSS 配置
```http
GET /api/rss/config
Authorization: Bearer <token>
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "rss_url": "https://rss.nodeseek.com/",
    "rss_interval_seconds": 60,
    "rss_proxy": ""
  }
}
```

#### 更新 RSS 配置
```http
PUT /api/rss/config
Authorization: Bearer <token>
Content-Type: application/json

{
  "rss_url": "https://rss.nodeseek.com/",
  "rss_interval_seconds": 60,
  "rss_proxy": "http://127.0.0.1:7890"
}
```

**参数说明**:
- `rss_url`: RSS 源地址（可选）
- `rss_interval_seconds`: 抓取间隔秒数，范围 10-3600（可选）
- `rss_proxy`: HTTP/HTTPS 代理地址，留空表示不使用代理（可选）

#### 测试 RSS 连接
```http
POST /api/rss/test-connection
Authorization: Bearer <token>
Content-Type: application/json

{
  "rss_url": "https://rss.nodeseek.com/"
}
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "accessible": true,
    "message": "RSS 源可正常访问"
  }
}
```

#### 重启 RSS 任务
修改抓取间隔后需要重启任务才能生效：
```http
POST /api/rss/restart
Authorization: Bearer <token>
```

**响应示例**:
```json
{
  "success": true,
  "message": "RSS 任务已重启"
}
```

### 获取定时任务状态
```http
GET /api/scheduler/status
Authorization: Bearer <token>
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "rssTask": {
      "running": true,
      "nextRun": "2024-01-01T12:01:00.000Z"
    },
    "cleanupTask": {
      "running": true,
      "nextRun": "2024-01-02T02:00:00.000Z"
    }
  }
}
```

### 手动执行 RSS 任务
```http
POST /api/scheduler/rss/run
Authorization: Bearer <token>
```

## 飞书集成

NodeSeeker 使用飞书官方 SDK 的 WebSocket 长连接接收 `im.message.receive_v1` 事件，不提供 webhook 接口。

飞书 `/add` 命令会发送 RSS 来源选择卡片，可连续选择一个或多个来源应用监控；关键词后添加 `-y` 可开启严格匹配，例如 `/add nc -y vps`。`/del 关键词` 会发送该关键词当前监控来源的取消卡片，仍可使用 `/del 订阅ID` 直接删除订阅。`/clear 30d` 或 `/clear 2m` 可清理指定时间以前的文章。

RSS 来源的 `subscription_enabled` 控制是否启用关键词订阅：`1` 表示按订阅关键词命中后推送，`0` 表示该来源新内容抓取后直接进入飞书推送流程。

RSS 来源的 `ai_translation_enabled` 控制推送前是否调用 AI 翻译。订阅的 `rss_source_ids` 可包含多个来源 ID；空数组表示全部来源。文章列表支持使用 `rssSourceId` 查询参数按来源过滤。

## AI 翻译

- `GET /api/ai-translation/config`：获取脱敏后的 AI 翻译配置和 RSS 来源列表。
- `PUT /api/ai-translation/config`：保存 Chat Completions API URL、API Key、模型和提示词；API URL 可使用服务根地址、`/v1` 地址或完整端点，来源开关通过 RSS 来源配置管理。
- `POST /api/ai-translation/test`：从已开启 AI 翻译的 RSS 来源抓取一篇文章，使用当前表单配置翻译并发送到已绑定飞书会话；不保存文章、推送状态或表单配置。

统计接口会返回 `ai_prompt_tokens`、`ai_completion_tokens` 和 `ai_total_tokens`。

### 获取应用状态
```http
GET /api/feishu/status
Authorization: Bearer <token>
```

### 测试应用和消息发送
```http
POST /api/feishu/test
Authorization: Bearer <token>
Content-Type: application/json

{
  "app_id": "cli_xxxxxxxxxxxxx",
  "app_secret": "your-app-secret",
  "chat_id": "oc_xxxxxxxxxxxxx"
}
```

## 错误响应格式

所有错误响应都遵循以下格式：

```json
{
  "success": false,
  "message": "错误描述",
  "code": "ERROR_CODE",
  "details": {}
}
```

### 常见错误码

- `400 Bad Request`: 请求参数错误
- `401 Unauthorized`: 未授权或 Token 无效
- `403 Forbidden`: 权限不足
- `404 Not Found`: 资源不存在
- `500 Internal Server Error`: 服务器内部错误

### 验证错误示例

```json
{
  "success": false,
  "message": "用户名不能为空",
  "field": "username",
  "code": "required"
}
```

## 数据模型

### BaseConfig
```typescript
interface BaseConfig {
  id?: number;
  username: string;
  password: string;
  feishu_app_id?: string;
  feishu_app_secret?: string;
  feishu_chat_id?: string;
  feishu_user_open_id?: string;
  bound_user_name?: string;
  bound_user_username?: string;
  stop_push: number;
  only_title: number;
  rss_url?: string;           // RSS 源地址
  rss_interval_seconds?: number;  // 抓取间隔秒数
  rss_proxy?: string;         // HTTP/HTTPS 代理地址
  created_at?: string;
  updated_at?: string;
}
```

### Post
```typescript
interface Post {
  id?: number;
  post_id: number;
  title: string;
  memo: string;
  category: string;
  creator: string;
  push_status: number; // 0: 未推送, 1: 已推送, 2: 无需推送
  sub_id?: number;
  pub_date: string;
  push_date?: string;
  created_at?: string;
}
```

### KeywordSub
```typescript
interface KeywordSub {
  id?: number;
  keyword1?: string;
  keyword2?: string;
  keyword3?: string;
  creator?: string;
  category?: string;
  created_at?: string;
  updated_at?: string;
}
```

## 使用示例

### JavaScript/Node.js
```javascript
const API_BASE = 'http://localhost:3010';
let token = '';

// 登录
async function login(username, password) {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username, password }),
  });
  
  const result = await response.json();
  if (result.success) {
    token = result.data.token;
  }
  return result;
}

// 获取文章列表
async function getPosts(page = 1, limit = 20) {
  const response = await fetch(`${API_BASE}/api/posts?page=${page}&limit=${limit}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });
  
  return await response.json();
}

// 添加订阅
async function addSubscription(keywords) {
  const response = await fetch(`${API_BASE}/api/subscriptions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      keyword1: keywords[0],
      keyword2: keywords[1],
      keyword3: keywords[2],
    }),
  });
  
  return await response.json();
}
```

### Python
```python
import requests

class NodeSeekerAPI:
    def __init__(self, base_url='http://localhost:3010'):
        self.base_url = base_url
        self.token = None
    
    def login(self, username, password):
        response = requests.post(f'{self.base_url}/auth/login', json={
            'username': username,
            'password': password
        })
        
        result = response.json()
        if result['success']:
            self.token = result['data']['token']
        return result
    
    def get_posts(self, page=1, limit=20):
        headers = {'Authorization': f'Bearer {self.token}'}
        response = requests.get(
            f'{self.base_url}/api/posts',
            headers=headers,
            params={'page': page, 'limit': limit}
        )
        return response.json()
    
    def add_subscription(self, keywords):
        headers = {
            'Authorization': f'Bearer {self.token}',
            'Content-Type': 'application/json'
        }
        data = {
            'keyword1': keywords[0] if len(keywords) > 0 else None,
            'keyword2': keywords[1] if len(keywords) > 1 else None,
            'keyword3': keywords[2] if len(keywords) > 2 else None,
        }
        response = requests.post(
            f'{self.base_url}/api/subscriptions',
            headers=headers,
            json=data
        )
        return response.json()

# 使用示例
api = NodeSeekerAPI()
api.login('admin', 'password123')
posts = api.get_posts(page=1, limit=10)
```
