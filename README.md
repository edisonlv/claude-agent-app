# Claude Agent App v2.0

跨平台的 Claude AI 客户端，支持桌面（Windows/macOS）和移动端（iOS/Android PWA）。

## 架构

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Electron    │     │   Sync       │     │  PWA         │
│  桌面端      │ ◄──► │   Server     │ ◄──► │  移动端      │
│  Win/Mac     │     │   (Express)  │     │  iOS/Android │
└─────────────┘     └──────────────┘     └─────────────┘
```

- **Electron 桌面端**：完整功能，本地运行
- **Sync Server**：数据同步服务 + PWA 托管
- **PWA 移动端**：手机浏览器或添加到主屏幕

## 快速开始

### 1. 启动同步服务器

```bash
cd claude-agent-app

# 安装依赖
npm install

# 启动服务器
npm run server
# 或指定端口和 token
PORT=3721 AUTH_TOKEN=your-token npm run server
```

服务器启动后会显示 Auth Token，手机端连接时需要输入。

### 2. 手机访问

在手机浏览器打开：
```
http://<你的电脑IP>:3721
```

1. 输入服务器显示的 Auth Token
2. 连接成功后即可使用
3. iOS/Android 可以"添加到主屏幕"获得 App 体验

### 3. 桌面端（可选）

```bash
# 构建 Electron 前端
npm run build

# 运行桌面端
npm start

# 打包安装包
npm run dist
```

## 功能

| 功能 | 桌面端 | 移动端 |
|------|--------|--------|
| AI 对话 | ✅ | ✅ |
| 流式响应 | ✅ | ✅ |
| 多 Provider | ✅ | ✅ |
| System Prompt | ✅ | ✅ |
| 对话管理 | ✅ | ✅ |
| 对话导出 | ✅ | ✅ |
| 定时任务 | ✅ | ✅ |
| Skills 管理 | ✅ | - |
| MCP 管理 | ✅ | - |
| 文件上传 | ✅ | - |
| 快捷键 | ✅ | - |
| 托盘图标 | ✅ | - |
| 多主题 | ✅ | - |
| Mermaid 图表 | ✅ | - |
| 代码高亮 | ✅ | ✅ |
| 数据同步 | ✅ | ✅ |

## 数据同步

桌面端和移动端通过同步服务器自动同步：
- 对话记录
- 配置信息
- 定时任务

## 安全

- API Key 桌面端本地加密存储（AES-256-GCM）
- 服务器 Token 认证
- 移动端通过 HTTPS 推荐
- 支持反向代理（Nginx）配合 SSL

## 部署建议

### 局域网使用
直接在电脑上运行 server，手机连同一 WiFi 访问。

### 远程访问
1. 部署到云服务器
2. 配置 Nginx 反向代理 + SSL
3. 手机通过公网地址访问

```nginx
server {
    listen 443 ssl;
    server_name agent.example.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    location / {
        proxy_pass http://127.0.0.1:3721;
        proxy_set_header Host $host;
    }
}
```

## License

MIT
